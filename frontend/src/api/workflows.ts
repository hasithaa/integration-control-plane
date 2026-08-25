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
  /** Who decided the task and when — () while it is pending, and for tasks decided before the
   *  runtime recorded the completer in the task's memo. */
  completedBy?: string;
  completedAt?: string;
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

// The workflow API is asynchronous end to end: the ICP holds no request open. A read may
// answer 202 {status: "FETCHING"} while a runtime materializes it (the ICP coalesces
// identical requests, so polling is cheap); a mutation always answers 202 {operationId} and
// its outcome — including "someone else got there first" — arrives on the operation poll.
// This helper absorbs that contract so every hook keeps its synchronous shape.
const WF_ASYNC_DEADLINE_MS = 75_000;
const WF_POLL_FALLBACK_MS = 750;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function wfFetchOnce(url: string, init: RequestInit): Promise<{ status: number; body: unknown; stale: boolean; fetchedAt?: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await authenticatedFetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let body: unknown = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { message: text };
      }
    }
    // The server marks an answer it is serving from an invalidated entry: a mutation staled
    // the scope, this copy predates it, and a single refresh is already running behind it.
    // Discarding this header was the whole stale-data bug — the client cached the
    // pre-mutation answer as fresh and never asked again.
    const stale = res.headers.get('x-workflow-stale') === 'true';
    const fetchedAtRaw = res.headers.get('x-workflow-fetched-at');
    const fetchedAt = fetchedAtRaw ? Number(fetchedAtRaw) : undefined;
    return { status: res.status, body, stale, fetchedAt };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Workflow service is unavailable. Request timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// crypto.randomUUID exists only in a secure context — HTTPS, or localhost. A console served
// over plain HTTP on any other host would throw here and fail every mutation before it was
// sent, so the key falls back to something unique enough for de-duplicating one submit.
const newIdempotencyKey = (): string => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `wf-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * A read that may not be answered yet.
 *
 * The workflow API materializes a read through the integration, so the first request for a
 * view nobody has opened recently is answered `202 {status:"FETCHING"}`. Waiting for it inside
 * the request — which is what this module used to do — makes the page hang with a spinner for
 * as long as it takes, and tells the user nothing. Surfacing the state instead lets the page
 * say so and come back for it.
 */
export type Fetchable<T> = { state: 'ready'; value: T; stale?: boolean; fetchedAt?: number } | { state: 'fetching'; retryAfterMs: number };

/** Named to sit beside react-query's own `isFetching` without being mistaken for it: this is
 *  the SERVER still preparing the answer, not the browser having a request in flight. */
export const isPreparing = <T>(r: Fetchable<T> | undefined): boolean => r?.state === 'fetching';
export const valueOf = <T>(r: Fetchable<T> | undefined): T | undefined => (r?.state === 'ready' ? r.value : undefined);

/** How soon to come back for a read the server is still preparing, when it names no interval. */
const WF_FETCHING_POLL_MS = 900;

/**
 * A read request that reports `fetching` rather than waiting for the answer.
 *
 * Used by the list and detail queries, whose caller is a page that can render the state. The
 * polling belongs to react-query here: it already knows how to come back, and it keeps the
 * previous answer on screen while it does.
 */
async function wfFetchable<T>(componentId: string, environmentId: string, subpath: string): Promise<Fetchable<T>> {
  const { status, body, stale, fetchedAt } = await wfFetchOnce(workflowApiUrl(componentId, environmentId, subpath), {});
  if (status === 202) {
    const accepted = (body ?? {}) as { retryAfterMs?: number };
    return { state: 'fetching', retryAfterMs: accepted.retryAfterMs ?? WF_FETCHING_POLL_MS };
  }
  if (status < 200 || status >= 300) {
    const b = body as { error?: { message?: string }; message?: string } | undefined;
    const error = new Error(b?.error?.message || b?.message || `Request failed (${status})`);
    (error as Error & { status?: number }).status = status;
    throw error;
  }
  return { state: 'ready', value: body as T, stale, fetchedAt };
}

/** How often to come back for an answer the server said is stale. Paced like a heartbeat, not
 *  like a spinner: every user's polls are answered from the ICP's row cache and the integration
 *  sees at most one coalesced refresh per entry regardless of user count — but the polls
 *  themselves land on the ICP, and a thousand open consoles at 2s would be 500 requests a
 *  second for freshness nobody can perceive. The page says when it last updated, and the
 *  refresh button covers impatience. */
const WF_STALE_POLL_MS = 30000;

/**
 * Comes back at the interval the server asked for while a read is still being prepared, and
 * keeps coming back while the served answer is STALE — a mutation invalidated it and the fresh
 * copy is on its way. Stopping on stale data was the bug: the pre-mutation answer stayed on
 * screen indefinitely, a completed task still reading as pending.
 */
/** A fresh answer younger than this keeps a gentle settle-poll: an answer produced right
 *  after a mutation can predate that mutation's effects, and a client parked on it would
 *  show the pre-mutation world until the page was reloaded. */
const WF_SETTLE_WINDOW_S = 65;
const WF_SETTLE_POLL_MS = 30000;

// ── Auto-refresh, as a choice ─────────────────────────────────────────────────
// Per viewer, persisted in the browser: the periodic "refreshing…" line is useful on a wall
// screen and distracting mid-thought, and only the person looking knows which mode they are in.
// Off means off — even a stale answer waits for the refresh button.
const AUTO_REFRESH_KEY = 'wf.autoRefresh';

export function autoRefreshEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_REFRESH_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAutoRefreshEnabled(on: boolean): void {
  try {
    localStorage.setItem(AUTO_REFRESH_KEY, on ? 'on' : 'off');
  } catch {
    // Storage unavailable: the toggle still works for this render, it just does not persist.
  }
}

const fetchableRefetch = <T>(data: Fetchable<T> | undefined): number | false => {
  // A read still being PREPARED always polls — there is nothing on screen to preserve, and
  // stopping would strand the view on "fetching…" forever. The toggle governs refreshing data
  // that is already shown.
  if (data?.state === 'fetching') return data.retryAfterMs;
  if (!autoRefreshEnabled()) return false;
  if (data?.state !== 'ready') return false;
  if (data.stale) return WF_STALE_POLL_MS;
  // Young answers keep being checked until they age out of the settle window; old ones rest.
  // These polls read the server's row cache — a refresh only happens once the row expires,
  // one coalesced fetch at a time, so nobody bursts.
  if (data.fetchedAt && Date.now() / 1000 - data.fetchedAt < WF_SETTLE_WINDOW_S) return WF_SETTLE_POLL_MS;
  return false;
};

/** True while the server is replacing this answer: it is shown, and its successor is coming. */
/** When this answer was produced (epoch seconds), for the "Updated at" display. */
export const fetchedAtOf = <T>(r: Fetchable<T> | undefined): number | undefined => (r?.state === 'ready' ? r.fetchedAt : undefined);

export const isRefreshing = <T>(r: Fetchable<T> | undefined): boolean => r?.state === 'ready' && r.stale === true;

/** Applies a projection to a ready value, so a hook can unwrap an envelope or default a
 *  field without losing the `fetching` state. */
const mapFetchable = <A, B>(r: Fetchable<A>, f: (a: A) => B): Fetchable<B> => (r.state === 'ready' ? { state: 'ready', value: f(r.value), stale: r.stale, fetchedAt: r.fetchedAt } : r);

/**
 * A request that waits for its answer. Mutations use this: the caller pressed a button, so a
 * spinner on that button is the honest thing to show, and a queued operation is polled by its
 * id rather than re-sent.
 */
async function wfRequest<T>(componentId: string, environmentId: string, subpath: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  let request = init;
  if (method !== 'GET') {
    // The key makes a browser-level retry or a double submit collapse onto one operation
    // server-side, instead of acting twice.
    request = { ...init, headers: { ...(init.headers ?? {}), 'x-idempotency-key': newIdempotencyKey() } };
  }
  const deadline = Date.now() + WF_ASYNC_DEADLINE_MS;
  let url = workflowApiUrl(componentId, environmentId, subpath);
  for (;;) {
    const { status, body } = await wfFetchOnce(url, request);
    if (status === 202) {
      const accepted = (body ?? {}) as { operationId?: string; retryAfterMs?: number };
      if (accepted.operationId) {
        // A queued mutation: from here on, poll its outcome. Never re-send the POST — the
        // operation row is the request now.
        url = workflowApiUrl(componentId, environmentId, `operations/${encodeURIComponent(accepted.operationId)}`);
        request = {};
      }
      if (Date.now() > deadline) {
        throw new Error('The workflow service is still preparing this data. Try again shortly.');
      }
      await sleep(accepted.retryAfterMs ?? WF_POLL_FALLBACK_MS);
      continue;
    }
    if (status < 200 || status >= 300) {
      const b = body as { error?: { message?: string }; message?: string } | undefined;
      const message = b?.error?.message || b?.message || `Request failed (${status})`;
      const error = new Error(message);
      (error as Error & { status?: number }).status = status;
      throw error;
    }
    return body as T;
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

function fetchDefinitions(componentId: string, environmentId: string): Promise<Fetchable<WorkflowDefinition[]>> {
  return wfFetchable<{ definitions: WorkflowDefinition[] }>(componentId, environmentId, 'definitions').then((r) => mapFetchable(r, (d) => d.definitions ?? []));
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

export function useWorkflowInstances(s: Scope, filters: WorkflowFilters) {
  return useQuery({
    queryKey: ['wf', 'instances', s.componentId, s.environmentId, filters],
    // Reports `fetching` on the first request for a view the server has not materialized yet,
    // so the page can say so instead of showing a spinner for however long it takes, and comes
    // back at the interval the server asked for.
    queryFn: () => wfFetchable<Page<WorkflowInstance>>(s.componentId, s.environmentId, `workflows${buildQuery({ ...filters })}`),
    refetchInterval: ({ state }) => fetchableRefetch(state.data),
    enabled: enabledFor(s),
  });
}

function fetchWorkflowInstances(componentId: string, environmentId: string, filters: WorkflowFilters): Promise<Fetchable<Page<WorkflowInstance>>> {
  return wfFetchable<Page<WorkflowInstance>>(componentId, environmentId, `workflows${buildQuery({ ...filters })}`);
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
    // A page still being prepared has no token to follow yet, so paging pauses rather than
    // reading "not ready" as "no more pages".
    getNextPageParam: (last) => {
      const page = valueOf(last);
      return page?.hasMore && page.nextPageToken ? page.nextPageToken : undefined;
    },
    refetchInterval: ({ state }) => fetchableRefetch(state.data?.pages[state.data.pages.length - 1]),
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
    queryFn: () => wfFetchable<WorkflowInstance>(s.componentId, s.environmentId, `workflows/${encodeURIComponent(workflowId!)}`),
    refetchInterval: ({ state }) => fetchableRefetch(state.data),
    enabled: enabledFor(s) && !!workflowId,
  });
}

export function useWorkflowHistory(s: Scope, workflowId: string | null) {
  return useQuery({
    queryKey: ['wf', 'history', s.componentId, s.environmentId, workflowId],
    queryFn: () => wfFetchable<{ events: HistoryEvent[] }>(s.componentId, s.environmentId, `workflows/${encodeURIComponent(workflowId!)}/history`).then((r) => mapFetchable(r, (d) => d.events ?? [])),
    refetchInterval: ({ state }) => fetchableRefetch(state.data),
    enabled: enabledFor(s) && !!workflowId,
  });
}

export function useWorkflowExecutionGraph(s: Scope, workflowId: string | null) {
  return useQuery({
    queryKey: ['wf', 'graph', s.componentId, s.environmentId, workflowId],
    queryFn: () => wfFetchable<ExecutionGraph>(s.componentId, s.environmentId, `workflows/${encodeURIComponent(workflowId!)}/execution-graph`),
    refetchInterval: ({ state }) => fetchableRefetch(state.data),
    enabled: enabledFor(s) && !!workflowId,
  });
}

export function useWorkflowInstanceGraph(s: Scope, workflowId: string | null) {
  return useQuery({
    queryKey: ['wf', 'instanceGraph', s.componentId, s.environmentId, workflowId],
    // Follows the same contract as every other read. On the blocking helper this was the one
    // view that still polled inside the request, so opening the graph on a cold cache sat there
    // until the client deadline instead of saying it was being prepared.
    queryFn: () => wfFetchable<InstanceGraph>(s.componentId, s.environmentId, `workflows/${encodeURIComponent(workflowId!)}/instance-graph`),
    refetchInterval: ({ state }) => fetchableRefetch(state.data),
    enabled: enabledFor(s) && !!workflowId,
  });
}

/**
 * Invalidates every workflow query for an environment, whichever component key each was cached
 * under. A project shares one Temporal namespace, so a listing is cached under the runtime that
 * served the read — the gateway — while a mutation is sent to the runtime that owns the row;
 * keying on the component would miss the very list the user is looking at.
 *
 * Deliberately not per-kind. The server invalidates its whole scope on any completed mutation,
 * because one action moves several views at once — a completed task changes the task list, the
 * unified queue, both badge counts, AND the parent workflow's status, history and graph. The
 * per-kind lists this replaces kept drifting behind that (task completion never refreshed the
 * work queue or the parent instance). Each refetch is answered from the server's row cache, so
 * matching its breadth costs a handful of locally-served GETs, not a burst at the integration.
 */
function invalidateForEnvironment(qc: ReturnType<typeof useQueryClient>, environmentId: string): void {
  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'wf' && q.queryKey[3] === environmentId });
}

export function useStartWorkflow(s: Scope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { workflowType: string; input?: unknown; workflowId?: string; timeoutSeconds?: number }) => wfRequest<WorkflowInstance>(s.componentId, s.environmentId, 'workflows', jsonBody({ method: 'POST' }, body)),
    onSuccess: () => invalidateForEnvironment(qc, s.environmentId),
  });
}

// ── Reset and bulk retry ──

/** One point a run can be reset to: a workflow-task event, named by the steps around it. */
export interface ResetPoint {
  eventId: number;
  eventType: string;
  timestamp: string;
  nodeIds: string[];
  nodeNames: string[];
  /** The point just before the run's first failure — usually the one a recovery wants. */
  isFirstFailure: boolean;
}

/** The reset points of a run, loaded only while the reset dialog is open — a history read has
 *  a cost, and most drawer visits never reset anything. */
export function useResetPoints(s: Scope, workflowId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['wf', 'reset-points', s.componentId, s.environmentId, workflowId],
    queryFn: () => wfFetchable<ResetPoint[]>(s.componentId, s.environmentId, `workflows/${encodeURIComponent(workflowId!)}/reset-points`),
    refetchInterval: ({ state }) => fetchableRefetch(state.data),
    enabled: enabledFor(s) && !!workflowId && enabled,
  });
}

export type ResetType = 'first-workflow-task' | 'last-workflow-task' | 'workflow-task-id';

/** Resets a run to a chosen workflow task: everything after the point re-executes as a new run
 *  of the same workflow ID — including activities whose side effects already happened. */
export function useResetWorkflow(s: Scope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workflowId, resetType, eventId, reason }: { workflowId: string; resetType: ResetType; eventId?: number; reason?: string }) =>
      wfRequest<{ workflowId?: string; runId?: string }>(s.componentId, s.environmentId, `workflows/${encodeURIComponent(workflowId)}/reset`, jsonBody({ method: 'POST' }, { resetType, eventId, reason })),
    onSuccess: () => invalidateForEnvironment(qc, s.environmentId),
  });
}

/** What one bulk decision did, item by item — a partial success is visible as itself. */
export interface BulkRetryResult {
  action: string;
  requested: number;
  applied: number;
  skipped: number;
  failed: number;
  items?: Array<{ taskId?: string; outcome?: string; detail?: string }>;
}

/**
 * Retries or fails several review activities in one decision — addressed by explicit ids, which
 * is how the work queue submits a selection. A plain request rather than a hook, because a
 * selection can span integrations and each batch must go to the runtime that owns its task
 * queue; the caller groups, calls this per owner, and invalidates once.
 */
export function bulkRetryReviewsRequest(s: Scope, body: { taskIds?: string[]; parentWorkflowId?: string; action: 'retry' | 'fail'; feedback?: string }): Promise<BulkRetryResult> {
  return wfRequest<BulkRetryResult>(s.componentId, s.environmentId, 'review-activities/bulk-retry', jsonBody({ method: 'POST' }, body));
}

/** Invalidates every workflow query for an environment — the client-side mirror of the server's
 *  scope-wide staling. Exported for callers that mutate outside useMutation. */
export function invalidateWorkflowQueries(qc: ReturnType<typeof useQueryClient>, environmentId: string): void {
  invalidateForEnvironment(qc, environmentId);
}

export type WorkflowLifecycleAction = 'suspend' | 'resume' | 'cancel' | 'terminate';

export function useWorkflowLifecycle(s: Scope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workflowId, action, reason }: { workflowId: string; action: WorkflowLifecycleAction; reason?: string }) => {
      const init = action === 'terminate' ? jsonBody({ method: 'POST' }, { reason: reason ?? '' }) : { method: 'POST' };
      return wfRequest<unknown>(s.componentId, s.environmentId, `workflows/${encodeURIComponent(workflowId)}/${action}`, init);
    },
    onSuccess: () => invalidateForEnvironment(qc, s.environmentId),
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

function fetchHumanTasks(componentId: string, environmentId: string, filters: HumanTaskFilters): Promise<Fetchable<Page<HumanTask>>> {
  return wfFetchable<Page<HumanTask>>(componentId, environmentId, `human-tasks${buildQuery({ ...filters })}`);
}

export function useHumanTasks(s: Scope, filters: HumanTaskFilters) {
  return useQuery({
    queryKey: ['wf', 'human-tasks', s.componentId, s.environmentId, filters],
    queryFn: () => fetchHumanTasks(s.componentId, s.environmentId, filters),
    refetchInterval: ({ state }) => fetchableRefetch(state.data),
    enabled: enabledFor(s),
  });
}

/** Paged the way the runtime pages — forward-only tokens — so "Load more" appends. */
export function useHumanTasksInfinite(s: Scope, filters: Omit<HumanTaskFilters, 'pageToken'>) {
  return useInfiniteQuery({
    queryKey: ['wf', 'human-tasks', s.componentId, s.environmentId, filters],
    queryFn: ({ pageParam }) => fetchHumanTasks(s.componentId, s.environmentId, { ...filters, pageToken: pageParam || undefined }),
    initialPageParam: '',
    // Each page is a Fetchable: a page still being prepared has no token to follow yet, so
    // paging stops until it arrives rather than treating "not ready" as "no more".
    getNextPageParam: (last) => {
      const page = valueOf(last);
      return page?.hasMore && page.nextPageToken ? page.nextPageToken : undefined;
    },
    refetchInterval: ({ state }) => fetchableRefetch(state.data?.pages[state.data.pages.length - 1]),
    enabled: enabledFor(s),
  });
}

function fetchPendingTaskCount(componentId: string, environmentId: string, taskQueue?: string): Promise<Fetchable<number>> {
  return wfFetchable<{ count: number }>(componentId, environmentId, `human-tasks/pending-count${buildQuery({ taskQueue })}`).then((r) => mapFetchable(r, (d) => d.count ?? 0));
}

/** `enabled` lets a caller skip the poll when the count is not being shown. */
export function usePendingTaskCount(s: Scope, taskQueue?: string, enabled = true) {
  return useQuery({
    queryKey: ['wf', 'pending-count', s.componentId, s.environmentId, taskQueue],
    queryFn: () => fetchPendingTaskCount(s.componentId, s.environmentId, taskQueue),
    enabled: enabledFor(s) && enabled,
    refetchInterval: ({ state }) => fetchableRefetch(state.data) || 30000,
  });
}

// Query options for one task's detail; shared by useHumanTask and useQueries-based batch fetches.
export function humanTaskQueryOptions(s: Scope, taskId: string) {
  return {
    queryKey: ['wf', 'human-task', s.componentId, s.environmentId, taskId] as const,
    queryFn: () => wfFetchable<HumanTask>(s.componentId, s.environmentId, `human-tasks/${encodeURIComponent(taskId)}`),
    // Without this the query reports `fetching` once and never asks again, which is worse
    // than the blocking behaviour it replaced: the dialog would spin until something else
    // happened to invalidate it.
    refetchInterval: ({ state }: { state: { data?: Fetchable<HumanTask> } }) => fetchableRefetch(state.data),
  };
}

export function useHumanTask(s: Scope, taskId: string | null, paused = false) {
  const options = humanTaskQueryOptions(s, taskId ?? '');
  return useQuery({
    ...options,
    // Paused while the person is filling the completion form: a background refetch swaps the
    // task object under their typing and flashes the refreshing line — churn they can feel,
    // about a task whose only interesting change is the one THEY are about to make.
    refetchInterval: paused ? false : options.refetchInterval,
    enabled: enabledFor(s) && !!taskId,
  });
}

function invalidateHumanTasks(qc: ReturnType<typeof useQueryClient>, s: Scope) {
  invalidateForEnvironment(qc, s.environmentId);
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

function fetchWorkItems(componentId: string, environmentId: string, filters: WorkItemFilters): Promise<Fetchable<Page<WorkItemRow>>> {
  return wfFetchable<Page<WorkItemRow>>(componentId, environmentId, `work-items${buildQuery({ ...filters })}`);
}

/** Paged the way the runtime pages — one token stream across both kinds. */
export function useWorkItemsInfinite(s: Scope, filters: Omit<WorkItemFilters, 'pageToken'>) {
  return useInfiniteQuery({
    queryKey: ['wf', 'work-items', s.componentId, s.environmentId, filters],
    // The last read hook still on the blocking helper: the work queue — the page people live
    // on — sat on a spinner for a cold cache and, worse, held a completed task as pending
    // because it never learned its answer had gone stale.
    queryFn: ({ pageParam }) => fetchWorkItems(s.componentId, s.environmentId, { ...filters, pageToken: pageParam || undefined }),
    initialPageParam: '',
    getNextPageParam: (last) => {
      const page = valueOf(last);
      return page?.hasMore && page.nextPageToken ? page.nextPageToken : undefined;
    },
    refetchInterval: ({ state }) => fetchableRefetch(state.data?.pages[state.data.pages.length - 1]),
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

async function fetchReviewActivities(componentId: string, environmentId: string, filters: ReviewActivityFilters): Promise<Fetchable<Page<ReviewActivity>>> {
  const items: ReviewActivity[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < REVIEW_ACTIVITY_MAX_PAGES; i++) {
    const result = await wfFetchable<Page<ReviewActivity>>(componentId, environmentId, `review-activities${buildQuery({ ...filters, pageToken })}`);
    // Each page is its own cached read, so any of them may still be being prepared. The
    // listing is reported as fetching until every page it needs has arrived: combining the
    // pages that did arrive would present a partial set as the whole.
    if (result.state === 'fetching') return result;
    const page = result.value;
    items.push(...(page.items ?? []));
    if (!page.hasMore || !page.nextPageToken) return { state: 'ready', value: { items, hasMore: false } };
    pageToken = page.nextPageToken;
  }
  return { state: 'ready', value: { items, hasMore: true } };
}

export function useReviewActivities(s: Scope, filters: ReviewActivityFilters) {
  return useQuery({
    queryKey: ['wf', 'review-activities', s.componentId, s.environmentId, filters],
    queryFn: () => fetchReviewActivities(s.componentId, s.environmentId, filters),
    refetchInterval: ({ state }) => fetchableRefetch(state.data),
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
    queryFn: (): Promise<Fetchable<PendingReviewCount>> =>
      wfFetchable<Page<ReviewActivity>>(s.componentId, s.environmentId, `review-activities${buildQuery({ status: 'PENDING', taskQueue, limit: PENDING_REVIEW_PAGE })}`).then((r) =>
        mapFetchable(r, (p) => ({
          count: p.items?.length ?? 0,
          capped: p.hasMore === true,
        })),
      ),
    enabled: enabledFor(s) && enabled,
    refetchInterval: ({ state }) => fetchableRefetch(state.data) || 30000,
  });
}

export function reviewActivityQueryOptions(s: Scope, taskId: string) {
  return {
    queryKey: ['wf', 'review-activity', s.componentId, s.environmentId, taskId] as const,
    queryFn: () => wfFetchable<ReviewActivityDetail>(s.componentId, s.environmentId, `review-activities/${encodeURIComponent(taskId)}`),
    refetchInterval: ({ state }: { state: { data?: Fetchable<ReviewActivityDetail> } }) => fetchableRefetch(state.data),
  };
}

export function useReviewActivity(s: Scope, taskId: string | null, paused = false) {
  const options = reviewActivityQueryOptions(s, taskId ?? '');
  return useQuery({
    ...options,
    // Same pause as useHumanTask: no background refetch under someone editing arguments.
    refetchInterval: paused ? false : options.refetchInterval,
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
    onSuccess: () => invalidateForEnvironment(qc, s.environmentId),
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
      refetchInterval: ({ state }: { state: { data?: Fetchable<WorkflowDefinition[]> } }) => fetchableRefetch(state.data),
      enabled: !!environmentId && !!t.componentId,
    })),
  });

  const items: Owned<WorkflowDefinition>[] = [];
  const failed: { componentName: string; message: string }[] = [];
  results.forEach((r, i) => {
    const target = targets[i];
    if (!target) return;
    // A target whose definitions are still being prepared contributes nothing yet; the query
    // comes back for it, and `isLoading` below keeps the caller from treating the partial
    // fan-out as complete.
    for (const d of valueOf(r.data) ?? []) {
      items.push({ ...d, componentId: target.componentId, componentName: target.componentName });
    }
    if (r.error && !isAbsent(r.error)) {
      failed.push({ componentName: target.componentName, message: r.error instanceof Error ? r.error.message : 'Request failed' });
    }
  });
  return {
    items,
    // Still "loading" while any target's definitions are being prepared server-side: the list
    // is genuinely incomplete until they arrive.
    isLoading: results.some((r) => r.isLoading || isPreparing(r.data)),
    failed,
  };
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
