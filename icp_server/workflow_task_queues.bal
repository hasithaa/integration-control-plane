// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied. See the License for the
// specific language governing permissions and limitations
// under the License.

import ballerina/http;
import ballerina/log;

import wso2/icp_server.storage;
import wso2/icp_server.types;

// GET .../task-queues — the Temporal task queue of every workflow integration in the asked
// component's project and environment, keyed by component id.
//
// A project shares one Temporal namespace, so an integration's executions are separated from its
// neighbours' only by the TaskQueue attribute — and the queue's name lives in the integration's own
// code, not in anything the ICP records about the component. Each runtime publishes it in the
// workflow metadata document on its heartbeats; this reads it back from that stored document, which
// is why the console can narrow a listing to one integration and route a row back to the
// integration that owns it.
//
// Served from the database alone — no tunneled call — so it answers even while a runtime is between
// heartbeats. A runtime built against a module that predates the field simply has no entry, and the
// console falls back to not narrowing, which is the pre-field behaviour.
isolated function handleTaskQueuesRequest(string componentId, string environmentId) returns http:Response {
    types:WorkflowMetadataRecord[]|error metadataRecords =
        storage:getWorkflowMetadataForProjectEnv(componentId, environmentId);
    if metadataRecords is error {
        log:printError("Failed to read stored workflow metadata for task queues",
                'error = metadataRecords, componentId = componentId);
        return workflowErrorResponse(500, "Failed to read the stored workflow metadata");
    }

    // Freshest heartbeat first (the query's order), so the first queue seen per component wins.
    map<string> queues = {};
    foreach types:WorkflowMetadataRecord metadataRecord in metadataRecords {
        if queues.hasKey(metadataRecord.componentId) {
            continue;
        }
        json|error document = metadataRecord.metadata.fromJsonString();
        if document !is map<json> {
            continue;
        }
        json taskQueue = document["taskQueue"];
        if taskQueue is string && taskQueue.length() > 0 {
            queues[metadataRecord.componentId] = taskQueue;
        }
    }

    http:Response response = new;
    response.statusCode = 200;
    response.setJsonPayload({taskQueues: queues.toJson()});
    return response;
}
