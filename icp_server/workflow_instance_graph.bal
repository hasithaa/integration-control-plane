// Copyright (c) 2026, WSO2 LLC. (http://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied. See the License for the
// specific language governing permissions and limitations
// under the License.

// ── GET .../workflows/{id}/instance-graph ────────────────────────────────────
//
// The one workflow endpoint that composes both halves of the control plane rather than
// relaying one of them:
//
//   the model      <- bi_workflow_metadata: the descriptor's graph for this workflow type,
//                     published in every full heartbeat. No call into the integration.
//   the executions <- the runtime, through the command tunnel: which steps ran, how often,
//                     and how they ended.
//
// Everything else under /icp/workflow is either a pure database read (definitions) or a pure
// tunnel passthrough (history, activity-tree, execution-graph). This one needs both, so it is
// handled before the request reaches the operation mapping.
//
// Why the join lives here and not in the console: matching an execution to a step, counting a
// loop's iterations and attaching a review task to the activity it gates are the rules of the
// instance-diagram specification, not presentation. Doing it once server-side means the VS Code
// designer and any other client get the same answer instead of each reimplementing them.
//
// `/execution-graph` is untouched — it still returns the runtime's history as a flat chain, which
// is what the timeline and history views want.

import ballerina/http;
import ballerina/log;
import wso2/icp_server.storage;
import wso2/icp_server.types;

// Execution node types that carry no step id of their own and are therefore placed by order
// against the model, mapped to the graph `kind` each corresponds to. Data events are the
// permanent case: a `wait events.x` is a language construct with no call site to stamp.
final map<string> & readonly INTERPOLATED_KINDS = {
    "DATA": "EVENT_WAIT",
    "TIMER": "SLEEP",
    "CHILD_WORKFLOW": "CHILD_WORKFLOW"
};

// A review task is not a step. It is drawn on the activity it gates, which it names through the
// step id in its memo.
const string REVIEW_ACTIVITY_TYPE = "REVIEW_ACTIVITY";

// Built-in implicit activities. `workflow:getResult` *is* a step — the author wrote a durable wait on
// another workflow, and the runtime routes it through an implicit activity so it stays deterministic —
// so it matches the model's AWAIT_RESULT node by activity name, since its node type is plain ACTIVITY.
// (`workflow:run` and `workflow:sendData` cannot appear at all: both are compile errors inside a
// workflow.) The rest are reads and the agent loop's own polling, and are dropped rather than
// reported: they are not steps and were never in the graph.
const string AWAIT_RESULT_ACTIVITY = "workflow:getResult";
final string[] & readonly NON_STEP_ACTIVITIES = ["workflow:getInfo", "workflow:pendingAgentDataEvents",
    "workflow:run", "workflow:sendData"];

// Composes the stored model with the instance's history.
//
// + componentId - the component whose metadata holds the model
// + environmentId - its environment
// + workflowId - the instance to describe
// + tunnelTarget - the runtime serving this environment's workflow commands
// + userId - the calling console user, for the tunnel's identity
// + roles - their roles, for the runtime's own gating
// + return - the composed instance graph, or the runtime's own failure relayed unchanged
isolated function handleInstanceGraphRequest(string componentId, string environmentId, string workflowId,
        string tunnelTarget, string userId, string[] roles) returns http:Response {

    // The instance says which workflow type it is; the tree says what ran. Two tunneled calls
    // because neither answer carries the other — the runtime could return the type with the tree
    // and save a round trip, which is a module-side improvement rather than a correctness issue.
    http:Response infoResponse = executeTunneledWorkflowCommand(tunnelTarget, "instances.get",
            {workflowId: workflowId}, userId, roles);
    if infoResponse.statusCode != 200 {
        return infoResponse;
    }
    map<json>? info = jsonObjectOf(infoResponse);
    if info is () {
        return workflowErrorResponse(502, "The workflow runtime returned an unreadable instance");
    }
    string workflowType = stringField(info, "workflowType") ?: "";
    if workflowType == "" {
        return workflowErrorResponse(502, "The workflow runtime did not report the instance's type");
    }

    http:Response treeResponse = executeTunneledWorkflowCommand(tunnelTarget, "instances.activityTree",
            {workflowId: workflowId}, userId, roles);
    if treeResponse.statusCode != 200 {
        return treeResponse;
    }
    map<json>? tree = jsonObjectOf(treeResponse);
    json[] executedNodes = tree is map<json> && tree["nodes"] is json[] ? <json[]>tree["nodes"] : [];

    [json, string, string]?|error model = workflowGraphFromStoredMetadata(componentId, environmentId,
            workflowType);
    if model is error {
        log:printError("Failed to read the stored workflow model", 'error = model,
                workflowType = workflowType);
        return workflowErrorResponse(500, "Failed to read the stored workflow model");
    }
    if model is () {
        // No runtime of this component has published a descriptor describing this type — an older
        // integration, or an instance of a workflow this component no longer declares. The history
        // is still worth returning; the console can draw it as a chain.
        return instanceGraphResponse(workflowType, info, (), (), "workflow", executedNodes, []);
    }
    if model[2] == "agent" {
        // An agent's loop is driven by the model, not by lexical call sites, so its executions
        // carry no step ids and the by-id join would only report noise. The star is returned as
        // the map; the console matches executions to it client-side, by what each node names.
        return instanceGraphResponse(workflowType, info, model[0], model[1], "agent", executedNodes, []);
    }
    return instanceGraphResponse(workflowType, info, model[0], model[1], "workflow", executedNodes,
            graphNodesOf(model[0]));
}

// Builds the response: the model as published, plus one entry per step that ran. For an agent
// the join is skipped entirely (modelNodes is empty and graphKind says why): its executions are
// matched to the star client-side, so reporting them as unmatched would be noise, not warning.
isolated function instanceGraphResponse(string workflowType, map<json> info, json? graph,
        string? checksum, string graphKind, json[] executedNodes, json[] modelNodes)
        returns http:Response {

    // stepId -> what happened to that step. A repeated id is a loop iteration or a re-run, so the
    // entry counts rather than duplicating: one graph node, one badge.
    map<map<json>> steps = {};
    map<json[]> reviews = {};
    json[] unmatched = [];
    // branch stepId -> the arms observed under it. An arm was taken iff something inside it ran;
    // no history event records a condition, so this is the only evidence there is.
    map<string[]> takenArms = {};

    // Where interpolation has reached in the model, so an unstamped event lands on the first
    // matching step at or after the last anchored one.
    int cursor = 0;

    // Whether any executed node named its step. The decoding happens in the runtime that serves the
    // read, so an integration built against a module without step ids reports none — and since a
    // project shares one Temporal namespace, that can be a *different* integration than the one that
    // owns the workflow. Saying so lets the console explain an unanchored drawing instead of
    // presenting every step as "not reached", which would be wrong rather than merely unhelpful.
    boolean sawStepId = false;
    int executedCount = 0;

    foreach json node in executedNodes {
        if node !is map<json> {
            continue;
        }
        string nodeType = stringField(node, "type") ?: "";
        string? stepId = stringField(node, "stepId");
        string nodeName = stringField(node, "name") ?: "";
        if NON_STEP_ACTIVITIES.indexOf(nodeName) !is () {
            // Machinery, not a step the author wrote.
            continue;
        }
        executedCount += 1;
        if stepId is string {
            sawStepId = true;
        }

        if nodeType == REVIEW_ACTIVITY_TYPE {
            // Attaches to the step it reviews, named by the step id in its memo. A review that
            // predates that carrier has nowhere to attach and is reported as unmatched.
            if stepId is string {
                json[] existing = reviews.hasKey(stepId) ? reviews.get(stepId) : [];
                existing.push(reviewEntry(node));
                reviews[stepId] = existing;
            } else {
                unmatched.push(unmatchedEntry(node, "a review task with no step id"));
            }
            continue;
        }

        string resolved;
        if stepId is string {
            resolved = stepId;
        } else {
            // Unstamped: placed by order against the model, which is sound because a workflow body
            // is single-threaded, so history is a linear walk.
            string? interpolated = interpolateStep(nodeType, nodeName, modelNodes, cursor);
            if interpolated is () {
                unmatched.push(unmatchedEntry(node, "no step id, and no matching step in the model"));
                continue;
            }
            resolved = interpolated;
        }
        int index = indexOfStep(modelNodes, resolved);
        if index >= cursor {
            cursor = index + 1;
        }
        recordExecution(steps, resolved, node);
        recordTakenArm(takenArms, modelNodes, resolved);
    }

    // Fold the reviews onto their steps, so a consumer never has to correlate them itself.
    foreach [string, json[]] [stepId, entries] in reviews.entries() {
        if steps.hasKey(stepId) {
            map<json> step = steps.get(stepId);
            step["reviews"] = entries;
            steps[stepId] = step;
        } else {
            foreach json entry in entries {
                unmatched.push(entry);
            }
        }
    }

    if graphKind == "agent" {
        map<json> agentPayload = {
            workflowType: workflowType,
            status: stringField(info, "status") ?: "UNKNOWN",
            descriptorChecksum: checksum,
            graphKind: graphKind,
            graph: graph,
            steps: {},
            takenArms: {},
            unmatched: [],
            stepIdsAvailable: true
        };
        http:Response agentResponse = new;
        agentResponse.statusCode = 200;
        agentResponse.setJsonPayload(agentPayload);
        return agentResponse;
    }

    map<json> payload = {
        workflowType: workflowType,
        graphKind: graphKind,
        status: stringField(info, "status") ?: "UNKNOWN",
        // The model comes from the *current* metadata, which a redeploy may have moved on from.
        // The checksum lets a console say "this run predates the current version" instead of
        // silently drawing a shape the run never followed.
        descriptorChecksum: checksum,
        graph: graph,
        steps: steps.toJson(),
        takenArms: takenArms.toJson(),
        unmatched: unmatched,
        // False only when steps ran and not one of them was named: the run cannot be placed on the
        // model at all. Guessing by activity name instead would draw a confident, wrong path, because
        // the same activity is often called from several arms — which is why step ids exist.
        stepIdsAvailable: executedCount == 0 || sawStepId
    };
    http:Response response = new;
    response.statusCode = 200;
    response.setJsonPayload(payload);
    return response;
}

// Accumulates one execution onto its step: the count is what a loop's badge shows, and the status
// is the latest one, so a step that failed and then succeeded on review reads as succeeded.
isolated function recordExecution(map<map<json>> steps, string stepId, map<json> node) {
    map<json> step = steps.hasKey(stepId) ? steps.get(stepId) : {count: 0, eventIds: []};
    int count = step["count"] is int ? <int>step["count"] : 0;
    step["count"] = count + 1;
    // Every history event this step produced, in order, so a consumer can pull the input and result
    // of a particular iteration: a step inside a loop has one entry per pass, not one per node.
    json[] eventIds = step["eventIds"] is json[] ? <json[]>step["eventIds"] : [];
    eventIds.push(node["id"]);
    step["eventIds"] = eventIds;
    step["type"] = node["type"];
    step["label"] = node["name"];
    step["status"] = node["status"];
    step["attempt"] = node["attempt"];
    if step["startTime"] is () {
        step["startTime"] = node["startTime"];
    }
    step["endTime"] = node["endTime"];
    if node["failure"] !is () {
        step["failure"] = node["failure"];
    }
    if node["childWorkflowId"] !is () {
        step["childWorkflowId"] = node["childWorkflowId"];
    }
    steps[stepId] = step;
}

// Records that the arm holding this step was taken, walking up the model's nesting so an inner
// step marks every container above it.
isolated function recordTakenArm(map<string[]> takenArms, json[] modelNodes, string stepId) {
    string? current = stepId;
    int guard = 0;
    while current is string && guard < 32 {
        guard += 1;
        map<json>? node = findStep(modelNodes, current);
        if node is () {
            return;
        }
        string? parentId = stringField(node, "parent");
        string? branchName = stringField(node, "branch");
        if parentId is () {
            return;
        }
        if branchName is () {
            return;
        }
        string[] arms = takenArms.hasKey(parentId) ? takenArms.get(parentId) : [];
        if arms.indexOf(branchName) is () {
            arms.push(branchName);
        }
        takenArms[parentId] = arms;
        current = parentId;
    }
}

// The first model step at or after `cursor` whose kind matches an unstamped event's type. Sound
// because a workflow body is single-threaded — `worker`, `fork` and `start` are compile errors —
// so history is a linear walk of the model and order is evidence.
isolated function interpolateStep(string nodeType, string nodeName, json[] modelNodes, int cursor)
        returns string? {
    // `workflow:getResult` arrives as an ACTIVITY, so it is recognised by name rather than by type.
    string? wantedKind = nodeName == AWAIT_RESULT_ACTIVITY ? "AWAIT_RESULT"
            : (INTERPOLATED_KINDS.hasKey(nodeType) ? INTERPOLATED_KINDS.get(nodeType) : ());
    if wantedKind is () {
        return ();
    }
    int index = cursor;
    while index < modelNodes.length() {
        json candidate = modelNodes[index];
        if candidate is map<json> && stringField(candidate, "kind") == wantedKind {
            return stringField(candidate, "stepId");
        }
        index += 1;
    }
    return ();
}

isolated function graphNodesOf(json graph) returns json[] {
    if graph is map<json> && graph["nodes"] is json[] {
        return <json[]>graph["nodes"];
    }
    return [];
}

isolated function findStep(json[] modelNodes, string stepId) returns map<json>? {
    foreach json node in modelNodes {
        if node is map<json> && stringField(node, "stepId") == stepId {
            return node;
        }
    }
    return ();
}

isolated function indexOfStep(json[] modelNodes, string stepId) returns int {
    int index = 0;
    while index < modelNodes.length() {
        json node = modelNodes[index];
        if node is map<json> && stringField(node, "stepId") == stepId {
            return index;
        }
        index += 1;
    }
    return -1;
}

isolated function reviewEntry(map<json> node) returns map<json> {
    return {
        taskId: node["childWorkflowId"],
        label: node["name"],
        status: node["status"],
        startTime: node["startTime"],
        endTime: node["endTime"]
    };
}

isolated function unmatchedEntry(map<json> node, string reason) returns map<json> {
    return {
        label: node["name"],
        'type: node["type"],
        status: node["status"],
        stepId: node["stepId"],
        reason: reason
    };
}

isolated function jsonObjectOf(http:Response response) returns map<json>? {
    json|error payload = response.getJsonPayload();
    return payload is map<json> ? payload : ();
}

isolated function stringField(map<json> value, string key) returns string? {
    json raw = value[key];
    return raw is string ? raw : ();
}

// The graph of one workflow type — a workflow's control flow or an agent's star — from any
// RUNNING runtime's published descriptor, with the descriptor's checksum and which of the two
// it is. Returns () when no runtime has described this type.
isolated function workflowGraphFromStoredMetadata(string componentId, string environmentId,
        string workflowType) returns [json, string, string]?|error {
    // Project-wide, not component-wide: the console may be reading through a different integration
    // than the one that owns this workflow, and the drawing must not silently degrade because of it.
    types:WorkflowMetadataRecord[] metadataRecords =
        check storage:getWorkflowMetadataForProjectEnv(componentId, environmentId);
    foreach types:WorkflowMetadataRecord metadataRecord in metadataRecords {
        json|error document = metadataRecord.metadata.fromJsonString();
        if document !is map<json> {
            continue;
        }
        json descriptor = document["descriptor"];
        if descriptor !is map<json> {
            continue;
        }
        string checksum = descriptor["checksum"] is string ? <string>descriptor["checksum"] : "";
        json workflows = descriptor["workflows"];
        if workflows is json[] {
            foreach json workflow in workflows {
                if workflow is map<json> && stringField(workflow, "name") == workflowType {
                    json graph = workflow["graph"];
                    if graph is map<json> {
                        return [graph, checksum, "workflow"];
                    }
                }
            }
        }
        // A durable agent's runner registers under the agent's own name, so an instance of it
        // asks for this same graph — the star the compiler drew, not lexical control flow.
        json agents = descriptor["agents"];
        if agents is json[] {
            foreach json agent in agents {
                if agent is map<json> && stringField(agent, "name") == workflowType {
                    json graph = agent["graph"];
                    if graph is map<json> {
                        return [graph, checksum, "agent"];
                    }
                }
            }
        }
    }
    return ();
}
