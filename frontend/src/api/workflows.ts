/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { authenticatedFetch } from '../auth/tokenManager';
import { workflowApiUrl } from '../config/api';

// ── Shared types (runtime-side shapes are loosely typed; known fields declared) ──

export interface WorkflowDefinition {
  workflowType: string;
  inputSchema?: string | null;
  isActive?: boolean;
  workerCount?: number;
}

export interface WorkflowInstance {
  workflowId: string;
  runId?: string;
  workflowType?: string;
  status?: string;
  /** What this instance is — WORKFLOW, AGENT, HUMAN_TASK, REVIEW_ACTIVITY, CHILD_WORKFLOW — from
   * the memo its starter stamped. Routing asks this, never the id's prefix. */
  kind?: string;
  startTime?: string;
  closeTime?: string;
  /** The project's Temporal namespace, and the task queue of the integration that owns this run. */
  namespace?: string;
  taskQueue?: string;
  [key: string]: unknown;
}

export interface Page<T> {
  items: T[];
  nextPageToken?: string | null;
  hasMore?: boolean;
}

export interface HumanTask {
  taskId: string;
  taskName?: string;
  title?: string;
  description?: string;
  payload?: Record<string, unknown>;
  formSchema?: Record<string, unknown> | string;
  parentWorkflowId?: string;
  parentWorkflowType?: string;
  status?: string;
  startTime?: string;
  closeTime?: string;
  userRoles?: string[];
  eligibleRoles?: string[];
  canComplete?: boolean;
  result?: unknown;
  namespace?: string;
  taskQueue?: string;
  [key: string]: unknown;
}

export interface ReviewActivity {
  taskId: string;
  taskName?: string;
  activityName?: string;
  parentWorkflowId?: string;
  parentWorkflowType?: string;
  status?: string;
  trigger?: string;
  startTime?: string;
  namespace?: string;
  taskQueue?: string;
  [key: string]: unknown;
}

export interface ReviewActivityDetail extends ReviewActivity {
  title?: string;
  description?: string;
  formSchema?: Record<string, unknown> | string;
  // The arguments the gated/failed activity would run with; always conforms to formSchema.
  activityArgs?: Record<string, unknown>;
  userRoles?: string[];
  errorMessage?: string;
  closeTime?: string;
  decidedBy?: string;
  decidedAt?: string;
}

export interface HistoryEvent {
  [key: string]: unknown;
}

// ── Execution graph (node-link DAG describing the run's dependency flow) ──

export interface ExecutionGraphNode {
  id: string;
  label: string;
  /** Node kind, e.g. WORKFLOW, ACTIVITY, HUMAN_TASK, SIGNAL, TIMER. */
  type: string;
  /** Same status vocabulary as workflow instances (RUNNING, COMPLETED, FAILED, …). */
  status?: string;
  metadata?: Record<string, unknown> | null;
}

export interface ExecutionGraphEdge {
  source: string;
  target: string;
  label?: string | null;
}

export interface ExecutionGraph {
  nodes: ExecutionGraphNode[];
  edges: ExecutionGraphEdge[];
}

// ── Instance graph (the workflow's own structure, joined to one run) ──
//
// The execution graph above is a run's history in the order it happened: it cannot say which branch
// of an `if` was taken, that three history nodes are one loop body running three times, or that a
// step was never reached. The instance graph answers all three by returning the workflow's published
// structure alongside the run, keyed on the step ids the compiler assigned to each call site.

/** A node of the workflow's *structure* — every step and control-flow block, whether or not it ran. */
export interface ModelGraphNode {
  /** Identity of this call site within its workflow, e.g. `reserveStock#2`, `if#1`, or an author-chosen `reserve-express`. */
  stepId: string;
  /** ACTIVITY | HUMAN_TASK | CHILD_WORKFLOW | EVENT_WAIT | SLEEP | AWAIT_RESULT | BRANCH | LOOP | TRY. */
  kind: string;
  /** What the node names — the activity, task, or child workflow. Absent for control flow. */
  target?: string;
  /** Display text: a branch condition, a looped expression. Never part of the identity. */
  label?: string;
  /** Step id of the enclosing control-flow node. Absent at the top level. */
  parent?: string;
  /** Which arm of `parent` this node sits in: `then`, `else`, `body`, `do`, `onFail`, or match patterns. */
  branch?: string;
  /** An agent tool's backing kind — ACTIVITY, AI_TOOL, PEER — which decides its rail category. */
  source?: string;
  line?: number;
  column?: number;
}

export interface ModelGraphEdge {
  from: string;
  to: string;
  /** Why this edge is taken: an arm name, loop `body`/`repeat`. */
  when?: string;
}

export interface ModelGraph {
  /** Source file the workflow body was read from. */
  file?: string;
  nodes: ModelGraphNode[];
  edges: ModelGraphEdge[];
}

/** A review task drawn on the step it gates, rather than as a step of its own. */
export interface StepReview {
  taskId?: string;
  label?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
}

/** What happened at one step of the model during this run. A step that never ran has no entry at all. */
export interface StepExecution {
  /** Executions of this one call site: >1 means a loop iterated, or the step was retried past a failure. */
  count: number;
  /** History event id per execution, in order, so a particular iteration's input and result can be recovered. */
  eventIds: string[];
  type?: string;
  label?: string;
  status?: string;
  attempt?: number;
  startTime?: string;
  endTime?: string;
  failure?: string;
  childWorkflowId?: string;
  reviews?: StepReview[];
}

/** An executed node that could not be placed on the model — a real gap, reported rather than hidden. */
export interface UnmatchedNode {
  label?: string;
  type?: string;
  status?: string;
  stepId?: string | null;
  reason?: string;
}

export interface InstanceGraph {
  workflowType: string;
  status: string;
  /** What the model describes: a workflow's control flow, or an agent's star. An agent's executions
   * carry no step ids (the model, not code, decides what runs), so they are matched client-side. */
  graphKind?: 'workflow' | 'agent';
  /** Checksum of the descriptor the model was read from; a redeploy may have moved on from the run. */
  descriptorChecksum?: string | null;
  /** Null when no runtime has published a descriptor for this type — draw the flat history instead. */
  graph: ModelGraph | null;
  /**
   * False when steps ran but none named itself, so the run cannot be placed on the model. Step ids are
   * decoded by the runtime that serves the read, and a project shares one Temporal namespace — so an
   * integration built against an older module can answer for a workflow it doesn't own and report none.
   */
  stepIdsAvailable?: boolean;
  /** Keyed by step id. */
  steps: Record<string, StepExecution>;
  /** Branch/loop/try step id → the arms something actually ran inside. The only evidence of a taken path. */
  takenArms: Record<string, string[]>;
  unmatched: UnmatchedNode[];
}

// ── Low-level request helper (mirrors logs.ts: timeout + error extraction) ──

async function wfRequest<T>(componentId: string, environmentId: string, subpath: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await authenticatedFetch(workflowApiUrl(componentId, environmentId, subpath), {
      ...init,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const text = await res.text();
      let message = text;
      try {
        const json = JSON.parse(text);
        message = json?.error?.message || json?.message || text;
      } catch {
        // keep raw text
      }
      const error = new Error(message || `Request failed (${res.status})`);
      (error as Error & { status?: number }).status = res.status;
      throw error;
    }
    // Some endpoints (204) have no body.
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Workflow service is unavailable. Request timed out.');
    }
    throw error;
  }
}

function jsonBody(init: RequestInit, body: unknown): RequestInit {
  return { ...init, headers: { ...(init.headers ?? {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== null) usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

// Scope-tuple used in every query key so cached data is isolated per component+env.
type Scope = { componentId: string; environmentId: string };
const enabledFor = (s: Scope) => !!s.componentId && !!s.environmentId;

// ── Definitions ──

function fetchDefinitions(componentId: string, environmentId: string): Promise<WorkflowDefinition[]> {
  return wfRequest<{ definitions: WorkflowDefinition[] }>(componentId, environmentId, 'definitions').then((d) => d.definitions ?? []);
}

// ── Workflow instances ──

export interface WorkflowFilters {
  status?: string;
  /** Restricts results to one integration's task queue; omitted covers the whole namespace. */
  taskQueue?: string;
  workflowType?: string;
  workflowId?: string;
  startTimeFrom?: string;
  startTimeTo?: string;
  limit?: number;
  pageToken?: string;
}

function fetchWorkflowInstances(componentId: string, environmentId: string, filters: WorkflowFilters): Promise<Page<WorkflowInstance>> {
  return wfRequest<Page<WorkflowInstance>>(componentId, environmentId, `workflows${buildQuery({ ...filters })}`);
}

export function useWorkflowInstances(s: Scope, filters: WorkflowFilters) {
  return useQuery({
    queryKey: ['wf', 'instances', s.componentId, s.environmentId, filters],
    queryFn: () => fetchWorkflowInstances(s.componentId, s.environmentId, filters),
    enabled: enabledFor(s),
  });
}

/**
 * The instance listing as forward-only pages, the way Temporal's visibility API pages: each page
 * hands back an opaque token for the next, so "load more" appends rather than jumping to an offset.
 * `pageToken` is owned by the pagination, which is why the caller's filters cannot carry one.
 */
export function useWorkflowInstancesInfinite(s: Scope, filters: Omit<WorkflowFilters, 'pageToken'>) {
  return useInfiniteQuery({
    queryKey: ['wf', 'instances', s.componentId, s.environmentId, filters],
    queryFn: ({ pageParam }) => fetchWorkflowInstances(s.componentId, s.environmentId, { ...filters, pageToken: pageParam || undefined }),
    initialPageParam: '',
    getNextPageParam: (last) => (last.hasMore && last.nextPageToken ? last.nextPageToken : undefined),
    enabled: enabledFor(s),
  });
}

/**
 * The Temporal task queue of every workflow integration in the gateway component's project and
 * environment, keyed by component id — read from the metadata each runtime publishes on heartbeat.
 *
 * This is the only place the console can learn which queue an integration's worker actually serves:
 * the component "handler" is just the component's name, and the two are unrelated strings. An
 * integration built against a module that predates the field has no entry, so callers fall back to
 * not narrowing rather than filtering by a queue that does not exist.
 */
export function useWorkflowTaskQueues(s: Scope) {
  return useQuery({
    queryKey: ['wf', 'task-queues', s.componentId, s.environmentId],
    queryFn: () => wfRequest<{ taskQueues: Record<string, string> }>(s.componentId, s.environmentId, 'task-queues').then((d) => d.taskQueues ?? {}),
    enabled: enabledFor(s),
    // Queues change on redeploy, not per interaction; a stale map self-corrects on the next fetch.
    staleTime: 60000,
  });
}

export function useWorkflowInfo(s: Scope, workflowId: string | null) {
  return useQuery({
    queryKey: ['wf', 'info', s.componentId, s.environmentId, workflowId],
    queryFn: () => wfRequest<WorkflowInstance>(s.componentId, s.environmentId, `workflows/${encodeURIComponent(workflowId!)}`),
    enabled: enabledFor(s) && !!workflowId,
  });
}

export function useWorkflowHistory(s: Scope, workflowId: string | null) {
  return useQuery({
    queryKey: ['wf', 'history', s.componentId, s.environmentId, workflowId],
    queryFn: () => wfRequest<{ events: HistoryEvent[] }>(s.componentId, s.environmentId, `workflows/${encodeURIComponent(workflowId!)}/history`).then((d) => d.events ?? []),
    enabled: enabledFor(s) && !!workflowId,
  });
}

export function useWorkflowExecutionGraph(s: Scope, workflowId: string | null) {
  return useQuery({
    queryKey: ['wf', 'graph', s.componentId, s.environmentId, workflowId],
    queryFn: () => wfRequest<ExecutionGraph>(s.componentId, s.environmentId, `workflows/${encodeURIComponent(workflowId!)}/execution-graph`),
    enabled: enabledFor(s) && !!workflowId,
  });
}

export function useWorkflowInstanceGraph(s: Scope, workflowId: string | null) {
  return useQuery({
    queryKey: ['wf', 'instanceGraph', s.componentId, s.environmentId, workflowId],
    queryFn: () => wfRequest<InstanceGraph>(s.componentId, s.environmentId, `workflows/${encodeURIComponent(workflowId!)}/instance-graph`),
    enabled: enabledFor(s) && !!workflowId,
  });
}

/**
 * Invalidates a workflow resource for an environment whichever component key it was cached under.
 * A project shares one Temporal namespace, so a listing is cached under the runtime that served the
 * read — the gateway — while a mutation is sent to the runtime that owns the row. Keying the
 * invalidation on the component would therefore miss the very list the user is looking at.
 */
function invalidateForEnvironment(qc: ReturnType<typeof useQueryClient>, environmentId: string, ...kinds: string[]): void {
  const wanted = new Set<unknown>(kinds);
  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'wf' && wanted.has(q.queryKey[1]) && q.queryKey[3] === environmentId });
}

export function useStartWorkflow(s: Scope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { workflowType: string; input?: unknown; workflowId?: string; timeoutSeconds?: number }) => wfRequest<WorkflowInstance>(s.componentId, s.environmentId, 'workflows', jsonBody({ method: 'POST' }, body)),
    onSuccess: () => invalidateForEnvironment(qc, s.environmentId, 'instances'),
  });
}

export type WorkflowLifecycleAction = 'suspend' | 'resume' | 'cancel' | 'terminate';

export function useWorkflowLifecycle(s: Scope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workflowId, action, reason }: { workflowId: string; action: WorkflowLifecycleAction; reason?: string }) => {
      const init = action === 'terminate' ? jsonBody({ method: 'POST' }, { reason: reason ?? '' }) : { method: 'POST' };
      return wfRequest<unknown>(s.componentId, s.environmentId, `workflows/${encodeURIComponent(workflowId)}/${action}`, init);
    },
    onSuccess: () => invalidateForEnvironment(qc, s.environmentId, 'instances', 'info'),
  });
}

// ── Human tasks ──

export interface HumanTaskFilters {
  status?: string;
  parentWorkflowId?: string;
  parentWorkflowType?: string;
  taskName?: string;
  taskQueue?: string;
  startTimeFrom?: string;
  startTimeTo?: string;
  limit?: number;
  pageToken?: string;
}

function fetchHumanTasks(componentId: string, environmentId: string, filters: HumanTaskFilters): Promise<Page<HumanTask>> {
  return wfRequest<Page<HumanTask>>(componentId, environmentId, `human-tasks${buildQuery({ ...filters })}`);
}

export function useHumanTasks(s: Scope, filters: HumanTaskFilters) {
  return useQuery({
    queryKey: ['wf', 'human-tasks', s.componentId, s.environmentId, filters],
    queryFn: () => fetchHumanTasks(s.componentId, s.environmentId, filters),
    enabled: enabledFor(s),
  });
}

/** Paged the way the runtime pages — forward-only tokens — so "Load more" appends. */
export function useHumanTasksInfinite(s: Scope, filters: Omit<HumanTaskFilters, 'pageToken'>) {
  return useInfiniteQuery({
    queryKey: ['wf', 'human-tasks', s.componentId, s.environmentId, filters],
    queryFn: ({ pageParam }) => fetchHumanTasks(s.componentId, s.environmentId, { ...filters, pageToken: pageParam || undefined }),
    initialPageParam: '',
    getNextPageParam: (last) => (last.hasMore && last.nextPageToken ? last.nextPageToken : undefined),
    enabled: enabledFor(s),
  });
}

function fetchPendingTaskCount(componentId: string, environmentId: string, taskQueue?: string): Promise<number> {
  return wfRequest<{ count: number }>(componentId, environmentId, `human-tasks/pending-count${buildQuery({ taskQueue })}`).then((d) => d.count ?? 0);
}

/** `enabled` lets a caller skip the poll when the count is not being shown. */
export function usePendingTaskCount(s: Scope, taskQueue?: string, enabled = true) {
  return useQuery({
    queryKey: ['wf', 'pending-count', s.componentId, s.environmentId, taskQueue],
    queryFn: () => fetchPendingTaskCount(s.componentId, s.environmentId, taskQueue),
    enabled: enabledFor(s) && enabled,
    refetchInterval: 30000,
  });
}

// Query options for one task's detail; shared by useHumanTask and useQueries-based batch fetches.
export function humanTaskQueryOptions(s: Scope, taskId: string) {
  return {
    queryKey: ['wf', 'human-task', s.componentId, s.environmentId, taskId] as const,
    queryFn: () => wfRequest<HumanTask>(s.componentId, s.environmentId, `human-tasks/${encodeURIComponent(taskId)}`),
  };
}

export function useHumanTask(s: Scope, taskId: string | null) {
  return useQuery({
    ...humanTaskQueryOptions(s, taskId ?? ''),
    enabled: enabledFor(s) && !!taskId,
  });
}

function invalidateHumanTasks(qc: ReturnType<typeof useQueryClient>, s: Scope) {
  invalidateForEnvironment(qc, s.environmentId, 'human-tasks', 'pending-count');
}

export function useCompleteHumanTask(s: Scope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, result }: { taskId: string; result: unknown }) => wfRequest<unknown>(s.componentId, s.environmentId, `human-tasks/${encodeURIComponent(taskId)}/complete`, jsonBody({ method: 'POST' }, { result })),
    onSuccess: () => invalidateHumanTasks(qc, s),
  });
}

export function useFailHumanTask(s: Scope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, reason, details }: { taskId: string; reason: string; details?: unknown }) => wfRequest<unknown>(s.componentId, s.environmentId, `human-tasks/${encodeURIComponent(taskId)}/fail`, jsonBody({ method: 'POST' }, { reason, details })),
    onSuccess: () => invalidateHumanTasks(qc, s),
  });
}

// ── Review activities ──
// (Replaces the deprecated retry-tasks routes; the runtime still exposes /retry-tasks
// for pre-0.7.0 clients but the UI uses /review-activities.)

// ── The unified work queue ──

/** One row of a person's work queue: a human task, or a review activity (a fixed decision). */
export interface WorkItemRow {
  kind: 'HUMAN_TASK' | 'REVIEW_ACTIVITY';
  taskId: string;
  taskName?: string;
  title?: string;
  /** Reviews only: PRE_RUN (approval gate) | ON_FAILURE (rerun decision). */
  trigger?: string;
  parentWorkflowId?: string;
  parentWorkflowType?: string;
  taskQueue?: string;
  status?: string;
  startTime?: string;
  closeTime?: string;
  canComplete?: boolean;
  [key: string]: unknown;
}

export interface WorkItemFilters {
  /** HUMAN_TASK or REVIEW_ACTIVITY; both when absent. The proxy narrows to the caller's permissions. */
  kind?: string;
  status?: string;
  parentWorkflowId?: string;
  parentWorkflowType?: string;
  taskQueue?: string;
  startTimeFrom?: string;
  startTimeTo?: string;
  limit?: number;
  pageToken?: string;
}

function fetchWorkItems(componentId: string, environmentId: string, filters: WorkItemFilters): Promise<Page<WorkItemRow>> {
  return wfRequest<Page<WorkItemRow>>(componentId, environmentId, `work-items${buildQuery({ ...filters })}`);
}

/** Paged the way the runtime pages — one token stream across both kinds. */
export function useWorkItemsInfinite(s: Scope, filters: Omit<WorkItemFilters, 'pageToken'>) {
  return useInfiniteQuery({
    queryKey: ['wf', 'work-items', s.componentId, s.environmentId, filters],
    queryFn: ({ pageParam }) => fetchWorkItems(s.componentId, s.environmentId, { ...filters, pageToken: pageParam || undefined }),
    initialPageParam: '',
    getNextPageParam: (last) => (last.hasMore && last.nextPageToken ? last.nextPageToken : undefined),
    enabled: enabledFor(s),
  });
}

export interface ReviewActivityFilters {
  status?: string;
  parentWorkflowId?: string;
  taskName?: string;
  taskQueue?: string;
  startTimeFrom?: string;
  startTimeTo?: string;
  limit?: number;
  pageToken?: string;
}

// Review-activity pages are fetched and combined up to this many pages so client-side
// filters (e.g. by workflow name, which the runtime API cannot filter on) see the
// full set rather than only the first page.
const REVIEW_ACTIVITY_MAX_PAGES = 20;

// Page size the badge count reads; a full page is reported as capped rather than as an exact total.
const PENDING_REVIEW_PAGE = 50;

async function fetchReviewActivities(componentId: string, environmentId: string, filters: ReviewActivityFilters): Promise<Page<ReviewActivity>> {
  const items: ReviewActivity[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < REVIEW_ACTIVITY_MAX_PAGES; i++) {
    const page = await wfRequest<Page<ReviewActivity>>(componentId, environmentId, `review-activities${buildQuery({ ...filters, pageToken })}`);
    items.push(...(page.items ?? []));
    if (!page.hasMore || !page.nextPageToken) return { items, hasMore: false };
    pageToken = page.nextPageToken;
  }
  return { items, hasMore: true };
}

export function useReviewActivities(s: Scope, filters: ReviewActivityFilters) {
  return useQuery({
    queryKey: ['wf', 'review-activities', s.componentId, s.environmentId, filters],
    queryFn: () => fetchReviewActivities(s.componentId, s.environmentId, filters),
    enabled: enabledFor(s),
  });
}

/** How many review activities are awaiting a decision, and whether that count hit the page cap. */
export interface PendingReviewCount {
  count: number;
  capped: boolean;
}

/**
 * Count of review activities awaiting a decision, for the tab badge. The runtime has no count
 * endpoint, so this reads a single PENDING page — one request, unlike the listing, which walks up to
 * REVIEW_ACTIVITY_MAX_PAGES so its client-side filters see everything. A full page reports `capped`
 * so the badge can say "50+" rather than claim exactly 50.
 */
export function usePendingReviewActivityCount(s: Scope, taskQueue?: string, enabled = true) {
  return useQuery({
    queryKey: ['wf', 'pending-review-count', s.componentId, s.environmentId, taskQueue],
    queryFn: (): Promise<PendingReviewCount> =>
      wfRequest<Page<ReviewActivity>>(s.componentId, s.environmentId, `review-activities${buildQuery({ status: 'PENDING', taskQueue, limit: PENDING_REVIEW_PAGE })}`).then((p) => ({
        count: p.items?.length ?? 0,
        capped: p.hasMore === true,
      })),
    enabled: enabledFor(s) && enabled,
    refetchInterval: 30000,
  });
}

export function reviewActivityQueryOptions(s: Scope, taskId: string) {
  return {
    queryKey: ['wf', 'review-activity', s.componentId, s.environmentId, taskId] as const,
    queryFn: () => wfRequest<ReviewActivityDetail>(s.componentId, s.environmentId, `review-activities/${encodeURIComponent(taskId)}`),
  };
}

export function useReviewActivity(s: Scope, taskId: string | null) {
  return useQuery({
    ...reviewActivityQueryOptions(s, taskId ?? ''),
    enabled: enabledFor(s) && !!taskId,
  });
}

export type ReviewDecision = 'proceed' | 'proceed-with-input' | 'reject';

export function useReviewDecision(s: Scope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, decision, input, feedback }: { taskId: string; decision: ReviewDecision; input?: unknown; feedback?: string }) => {
      let init: RequestInit;
      if (decision === 'proceed-with-input') init = jsonBody({ method: 'POST' }, { input });
      else if (decision === 'reject') init = jsonBody({ method: 'POST' }, { feedback });
      else init = { method: 'POST' };
      return wfRequest<unknown>(s.componentId, s.environmentId, `review-activities/${encodeURIComponent(taskId)}/${decision}`, init);
    },
    onSuccess: () => invalidateForEnvironment(qc, s.environmentId, 'review-activities', 'pending-review-count'),
  });
}

// ── Project-scope workflow management ────────────────────────────────────────
//
// A project shares one Temporal engine. Every runtime in it is bound to the same namespace
// (`namespace = <project>` in the runtime config) and differs only by task queue
// (`taskQueue = <integration>`). The management API relays to that engine, so any one runtime
// answers for the whole project: calling every integration's callback URL is unnecessary and would
// return the same namespace-wide rows once per runtime.
//
// Reads therefore go through a single gateway runtime, and scope is expressed with the `taskQueue`
// query parameter that the listings and pending-count accept:
//   - integration scope - taskQueue is that integration, so only its rows come back;
//   - project scope - taskQueue omitted, covering every task queue in the namespace, and never
//     another namespace, since the client is namespace-bound.
// Each record carries its own namespace/taskQueue, and that is what routes a follow-up operation
// back to the integration that owns it.
//
// `/definitions` is the exception: it takes no taskQueue and reports only what its own runtime
// hosts, so a project-wide list of startable workflows does have to ask every integration.

export interface WorkflowTarget {
  componentId: string;
  componentName: string;
  /** The component handler — what the runtime is configured with as its `taskQueue`. */
  handler: string;
}

/** A value tagged with the integration it came from. */
export type Owned<T> = T & { componentId: string; componentName: string };

/** Resolves a record's `taskQueue` back to the integration that owns it, when it is one we know. */
export function targetForTaskQueue(targets: WorkflowTarget[], taskQueue?: string): WorkflowTarget | undefined {
  return taskQueue ? targets.find((t) => t.handler === taskQueue) : undefined;
}

/**
 * 403/404/503 mean "this integration has nothing to contribute" — no running workflow runtime, or
 * not visible to the caller — rather than a failure worth reporting.
 */
function isAbsent(e: unknown): boolean {
  const status = (e as { status?: number } | null | undefined)?.status;
  return status === 403 || status === 404 || status === 503;
}

export interface DefinitionsAcross {
  /** Every startable workflow, tagged with the integration whose runtime hosts it. */
  items: Owned<WorkflowDefinition>[];
  isLoading: boolean;
  failed: { componentName: string; message: string }[];
}

/**
 * Workflow definitions from every target. This is the one listing that must fan out, because
 * `/definitions` is runtime-local: it backs the project-wide "start a workflow" choice, where the
 * chosen definition also determines which runtime to start it on.
 */
export function useWorkflowDefinitionsAcross(targets: WorkflowTarget[], environmentId: string): DefinitionsAcross {
  const results = useQueries({
    queries: targets.map((t) => ({
      queryKey: ['wf', 'definitions', t.componentId, environmentId],
      queryFn: () => fetchDefinitions(t.componentId, environmentId),
      enabled: !!environmentId && !!t.componentId,
    })),
  });

  const items: Owned<WorkflowDefinition>[] = [];
  const failed: { componentName: string; message: string }[] = [];
  results.forEach((r, i) => {
    const target = targets[i];
    if (!target) return;
    for (const d of r.data ?? []) {
      items.push({ ...d, componentId: target.componentId, componentName: target.componentName });
    }
    if (r.error && !isAbsent(r.error)) {
      failed.push({ componentName: target.componentName, message: r.error instanceof Error ? r.error.message : 'Request failed' });
    }
  });
  return { items, isLoading: results.some((r) => r.isLoading), failed };
}

/**
 * Distinct workflow types, for the workflow-name filter — several integrations in a project may
 * host the same type and the filter only needs one entry per name.
 */
export function distinctWorkflowTypes(definitions: WorkflowDefinition[]): WorkflowDefinition[] {
  const byType = new Map<string, WorkflowDefinition>();
  for (const d of definitions) {
    if (!byType.has(d.workflowType)) byType.set(d.workflowType, d);
  }
  return [...byType.values()];
}
