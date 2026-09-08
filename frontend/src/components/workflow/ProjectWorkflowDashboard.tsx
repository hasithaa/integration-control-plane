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

import { Alert, Chip, CircularProgress, ListingTable, Snackbar, Stack, Tooltip, Typography } from '@wso2/oxygen-ui';
import { Workflow } from '@wso2/oxygen-ui-icons-react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type JSX } from 'react';
import { useNavigate } from 'react-router';
import { useProjectRuntimes, type GqlRuntime } from '../../api/queries';
import {
  instanceCountQueryOptions,
  invalidateWorkflowQueries,
  isPreparing,
  pendingReviewCountQueryOptions,
  pendingWorkItemsQueryOptions,
  totalPendingTaskCountQueryOptions,
  useWorkflowDefinitionsAcross,
  valueOf,
  type CappedCount,
  type PendingReviewCount,
} from '../../api/workflows';
import { narrow, resourceUrl, type ProjectScope } from '../../nav';
import { formatDistanceToNow } from '../../utils/time';
import { ReviewActivityDetailDialog, type Toast } from './AdminPortal';
import { HeaderCell, StatusChip } from './shared';
import { TaskDetailDialog, toWorkItem, WorkItemTable, type WorkItem } from './UserPortal';
import type { WorkflowIntegrationEntry } from './useWorkflowPageScope';

/**
 * The project level. Listing every instance project-wide is impossible by construction —
 * integrations may run against different Temporal servers or namespaces, and no single runtime
 * can see the others' work — so the project answers different questions, each by fanning out one
 * bounded request per integration and merging client-side.
 *
 * Executions: how is each integration's workflow doing right now? A stats table, one row per
 * integration in the selected environment, with the numbers that say healthy-or-not and a
 * drill-down into that integration's own pages.
 *
 * Human Tasks: what is waiting for ME, across the project? That page is personal — only work the
 * caller can act on — so the project level is an inbox: every pending task and review from every
 * integration in one list, oldest first, each opening its own drawer in place. Picking an
 * integration first was a menu standing where the work should be.
 */
export default function ProjectWorkflowDashboard({
  scope,
  projectId,
  environmentId,
  integrations,
  resource,
  canViewHumanTasks,
  canViewWorkflows,
}: {
  scope: ProjectScope;
  projectId: string;
  environmentId: string;
  integrations: WorkflowIntegrationEntry[];
  resource: 'tasks' | 'workflows';
  canViewHumanTasks: boolean;
  canViewWorkflows: boolean;
}): JSX.Element {
  // Which integrations actually run in THIS environment. The list comes from the project's
  // components — environment-independent — so without this, switching to an environment with no
  // deployments kept showing rows whose numbers could never load.
  const { data: runtimes, isPending: runtimesPending } = useProjectRuntimes(environmentId, projectId);
  const runtimeByComponent = useMemo(() => latestRuntimeByComponent(runtimes), [runtimes]);
  const deployedIds = runtimes === undefined ? undefined : new Set(runtimeByComponent.keys());
  if (integrations.length === 0) {
    return <Typography sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>No workflow integrations in this project yet. An integration that declares workflows appears here after its first heartbeat.</Typography>;
  }
  if (resource === 'workflows') {
    return <WorkflowStatsTable scope={scope} environmentId={environmentId} integrations={integrations} runtimeByComponent={runtimeByComponent} deployedIds={runtimesPending ? undefined : deployedIds} canViewHumanTasks={canViewHumanTasks} canViewWorkflows={canViewWorkflows} />;
  }
  return <ProjectInbox scope={scope} environmentId={environmentId} integrations={integrations} deployedIds={runtimesPending ? undefined : deployedIds} />;
}

/** One runtime per component — the most recently heard from, when an integration has several. */
function latestRuntimeByComponent(runtimes: GqlRuntime[] | undefined): Map<string, GqlRuntime> {
  const byComponent = new Map<string, GqlRuntime>();
  for (const r of runtimes ?? []) {
    const id = r.component?.id;
    if (!id) continue;
    const current = byComponent.get(id);
    if (!current || (r.lastHeartbeat ?? '') > (current.lastHeartbeat ?? '')) byComponent.set(id, r);
  }
  return byComponent;
}

// ── The inbox ──

/**
 * Every pending task and review the caller can act on, from every deployed integration, in one
 * list — oldest first, because the oldest item is the one someone has been waiting on longest.
 * One bounded page per integration: the runtime already scopes the listing to what this caller's
 * roles allow, so nothing is filtered here, and the page size bounds the cost of the fan-out.
 */
function ProjectInbox({ scope, environmentId, integrations, deployedIds }: { scope: ProjectScope; environmentId: string; integrations: WorkflowIntegrationEntry[]; deployedIds: Set<string> | undefined }): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<Toast>(null);
  const [openTask, setOpenTask] = useState<WorkItem | null>(null);
  const [openReview, setOpenReview] = useState<WorkItem | null>(null);

  const deployed = useMemo(() => integrations.filter((i) => deployedIds?.has(i.componentId)), [integrations, deployedIds]);
  const results = useQueries({ queries: deployed.map((d) => pendingWorkItemsQueryOptions({ componentId: d.componentId, environmentId })) });

  // Merge the pages. Each item remembers the integration that answered for it (its drawer is
  // that integration's), and the table labels rows by task queue, so the queue → name map is
  // built from the rows themselves with the integration's own name as the fallback.
  const { items, labels, failed, perIntegration } = useMemo(() => {
    const merged: WorkItem[] = [];
    const labels = new Map<string, string>();
    const failed: string[] = [];
    const perIntegration = new Map<string, number>();
    deployed.forEach((d, i) => {
      const r = results[i];
      labels.set(d.componentId, d.name);
      if (r?.error) failed.push(d.name);
      const rows = valueOf(r?.data)?.items ?? [];
      perIntegration.set(d.componentId, rows.length);
      for (const row of rows) {
        const item = toWorkItem(row);
        item.componentId = d.componentId;
        if (item.taskQueue) labels.set(item.taskQueue, d.name);
        else item.taskQueue = d.componentId;
        merged.push(item);
      }
    });
    // Oldest first — ISO-8601 sorts lexicographically. Items without a time sink to the end.
    merged.sort((a, b) => (a.startTime ?? '￿').localeCompare(b.startTime ?? '￿'));
    return { items: merged, labels, failed, perIntegration };
    // `results` is a fresh array each render; recomputing is cheap and keeps the list current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployed, ...results.map((r) => r.data), ...results.map((r) => r.error)]);

  const preparing = deployedIds === undefined || results.some((r) => r.isPending || isPreparing(r.data));
  const tasks = items.filter((w) => w.kind === 'task').length;
  const reviews = items.length - tasks;
  const oldest = items[0]?.startTime;
  const undeployed = deployedIds === undefined ? 0 : integrations.length - deployed.length;

  const refresh = () => invalidateWorkflowQueries(queryClient, environmentId);
  const openQueue = (componentId: string) => {
    const integration = integrations.find((i) => i.componentId === componentId);
    if (integration) navigate(`${resourceUrl(narrow(scope, integration.routeHandler), 'tasks')}?env=${encodeURIComponent(environmentId)}`);
  };

  return (
    <Stack gap={2}>
      <Typography variant="body2" color="text.secondary">
        Everything waiting for you across this environment's integrations, oldest first. Open an item to decide it here; an integration's name opens its own queue.
      </Typography>

      {/* The strip: the shape of the queue at a glance, and where it comes from. */}
      <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
        <Chip size="small" variant={tasks > 0 ? 'filled' : 'outlined'} color={tasks > 0 ? 'primary' : 'default'} label={preparing ? '… tasks' : `${tasks} task${tasks === 1 ? '' : 's'}`} />
        <Chip size="small" variant={reviews > 0 ? 'filled' : 'outlined'} color={reviews > 0 ? 'primary' : 'default'} label={preparing ? '… reviews' : `${reviews} review${reviews === 1 ? '' : 's'}`} />
        {!preparing && oldest && <Chip size="small" variant="outlined" label={`oldest waiting ${formatDistanceToNow(oldest)}`} />}
        {deployed.length > 1 &&
          deployed.map((d) => (
            <Tooltip key={d.componentId} title={`Open the ${d.name} queue`}>
              <Chip size="small" variant="outlined" onClick={() => openQueue(d.componentId)} label={`${d.name} · ${preparing && perIntegration.get(d.componentId) === undefined ? '…' : (perIntegration.get(d.componentId) ?? 0)}`} sx={{ cursor: 'pointer' }} />
            </Tooltip>
          ))}
        {undeployed > 0 && (
          <Typography variant="caption" color="text.disabled">
            {undeployed} integration{undeployed === 1 ? '' : 's'} not deployed in this environment.
          </Typography>
        )}
      </Stack>

      {failed.length > 0 && <Alert severity="warning">{`Could not load the queue from ${failed.join(', ')}; the list may be missing their items.`}</Alert>}

      {preparing && items.length === 0 ? (
        <CircularProgress size={24} sx={{ display: 'block', mx: 'auto', py: 4 }} />
      ) : items.length === 0 ? (
        <Typography sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>Nothing is waiting for you across {deployed.length === 1 ? 'this integration' : `these ${deployed.length} integrations`}.</Typography>
      ) : (
        <WorkItemTable items={items} onOpen={(w) => (w.kind === 'review' ? setOpenReview(w) : setOpenTask(w))} environmentId={environmentId} integrationLabel={(q) => labels.get(q ?? '') ?? q ?? '—'} />
      )}

      {/* Each item opens the drawer its own integration would — decisions go to the runtime that
          owns the item, and a decision refreshes every view of this environment. */}
      {openTask?.componentId && (
        <TaskDetailDialog
          scope={{ componentId: openTask.componentId, environmentId }}
          taskId={openTask.id}
          actionable={!openTask.readOnly}
          onClose={() => setOpenTask(null)}
          onToast={setToast}
          onDecided={(message) => {
            setOpenTask(null);
            setToast({ severity: 'success', message });
            refresh();
          }}
        />
      )}
      {openReview?.componentId && (
        <ReviewActivityDetailDialog
          scope={{ componentId: openReview.componentId, environmentId }}
          taskId={openReview.id}
          onClose={() => {
            setOpenReview(null);
            refresh();
          }}
          onToast={setToast}
        />
      )}

      <Snackbar open={toast !== null} autoHideDuration={4000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)} sx={{ width: '100%' }}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Stack>
  );
}

// ── The stats table ──

/** One integration's numbers. `undefined` is still loading; a metric that failed to load is `null`. */
interface IntegrationStats {
  running?: CappedCount | null;
  suspended?: CappedCount | null;
  failed?: CappedCount | null;
  completed?: CappedCount | null;
  reviews?: PendingReviewCount | null;
  tasks?: number | null;
}

/**
 * Six counts per deployed integration, fanned out with one batch per metric so the table and the
 * totals above it read from one set of results. The runtime scopes every listing to the
 * integration's own task queue on the server, so no queue needs naming here.
 */
function useProjectWorkflowStats(deployed: WorkflowIntegrationEntry[], environmentId: string, since: string): Map<string, IntegrationStats> {
  const scopes = deployed.map((d) => ({ componentId: d.componentId, environmentId }));
  const running = useQueries({ queries: scopes.map((s) => instanceCountQueryOptions(s, { status: 'RUNNING' })) });
  const suspended = useQueries({ queries: scopes.map((s) => instanceCountQueryOptions(s, { status: 'SUSPENDED' })) });
  const failed = useQueries({ queries: scopes.map((s) => instanceCountQueryOptions(s, { status: 'FAILED', closeTimeFrom: since })) });
  const completed = useQueries({ queries: scopes.map((s) => instanceCountQueryOptions(s, { status: 'COMPLETED', closeTimeFrom: since })) });
  const reviews = useQueries({ queries: scopes.map((s) => pendingReviewCountQueryOptions(s)) });
  const tasks = useQueries({ queries: scopes.map((s) => totalPendingTaskCountQueryOptions(s)) });

  // A metric that errored reads as null — shown as "—" — rather than spinning forever as "…".
  const settle = <T,>(r: { data?: unknown; error: unknown } | undefined): T | null | undefined => {
    if (!r) return undefined;
    if (r.error) return null;
    return valueOf(r.data as Parameters<typeof valueOf>[0]) as T | undefined;
  };
  const stats = new Map<string, IntegrationStats>();
  deployed.forEach((d, i) => {
    stats.set(d.componentId, {
      running: settle<CappedCount>(running[i]),
      suspended: settle<CappedCount>(suspended[i]),
      failed: settle<CappedCount>(failed[i]),
      completed: settle<CappedCount>(completed[i]),
      reviews: settle<PendingReviewCount>(reviews[i]),
      tasks: settle<number>(tasks[i]),
    });
  });
  return stats;
}

/** A capped count as text: exact below the page size, "50+" at it, "…" while loading, "—" when unavailable. */
const countText = (c: CappedCount | PendingReviewCount | null | undefined): string => (c === undefined ? '…' : c === null ? '—' : `${c.count}${c.capped ? '+' : ''}`);
const numberText = (n: number | null | undefined): string => (n === undefined ? '…' : n === null ? '—' : String(n));

/** Sums one capped metric across rows; pending while any row is, capped when any row was. */
function totalOf(rows: IntegrationStats[], pick: (s: IntegrationStats) => CappedCount | PendingReviewCount | null | undefined): { text: string; count: number } {
  let count = 0;
  let capped = false;
  let pending = false;
  for (const row of rows) {
    const v = pick(row);
    if (v === undefined) pending = true;
    else if (v) {
      count += v.count;
      capped = capped || v.capped;
    }
  }
  return { text: pending ? '…' : `${count}${capped ? '+' : ''}`, count };
}

function WorkflowStatsTable({
  scope,
  environmentId,
  integrations,
  runtimeByComponent,
  deployedIds,
  canViewHumanTasks,
  canViewWorkflows,
}: {
  scope: ProjectScope;
  environmentId: string;
  integrations: WorkflowIntegrationEntry[];
  runtimeByComponent: Map<string, GqlRuntime>;
  /** Undefined while the environment's runtimes are still resolving. */
  deployedIds: Set<string> | undefined;
  canViewHumanTasks: boolean;
  canViewWorkflows: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  // The 24h window is fixed once per mount: it is part of every count's query key, and a value
  // that moved every render would refetch in a loop. A page reload starts a fresh window.
  const since = useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), []);
  const deployed = useMemo(() => integrations.filter((i) => deployedIds?.has(i.componentId)), [integrations, deployedIds]);
  const stats = useProjectWorkflowStats(deployed, environmentId, since);
  // Definitions come from stored heartbeat metadata — no call into the runtime — tagged by owner.
  const definitions = useWorkflowDefinitionsAcross(
    deployed.map((d) => ({ componentId: d.componentId, componentName: d.name, handler: d.routeHandler })),
    environmentId,
  );
  const typesByComponent = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of definitions.items) m.set(d.componentId, (m.get(d.componentId) ?? 0) + 1);
    return m;
  }, [definitions.items]);
  const canSeeWork = canViewHumanTasks || canViewWorkflows;

  // The strip: what needs attention across the project. Runtimes come from the heartbeat, so the
  // offline count is known before any runtime has answered a question.
  const rows = deployed.map((d) => stats.get(d.componentId) ?? {});
  const offline = deployed.filter((d) => (runtimeByComponent.get(d.componentId)?.status ?? '').toUpperCase() !== 'RUNNING').length;
  const failedTotal = totalOf(rows, (s) => s.failed);
  const reviewsTotal = totalOf(rows, (s) => s.reviews);
  const tasksPending = rows.some((s) => s.tasks === undefined);
  const tasksTotal = rows.reduce((n, s) => n + (typeof s.tasks === 'number' ? s.tasks : 0), 0);

  const openExecutions = (integration: WorkflowIntegrationEntry) => navigate(`${resourceUrl(narrow(scope, integration.routeHandler), 'workflows')}?env=${encodeURIComponent(environmentId)}`);
  const openTasks = (integration: WorkflowIntegrationEntry, tab?: 'reviews') => navigate(`${resourceUrl(narrow(scope, integration.routeHandler), 'tasks')}${tab ? `?tab=${tab}&` : '?'}env=${encodeURIComponent(environmentId)}`);

  return (
    <Stack gap={2}>
      <Typography variant="body2" color="text.secondary">
        How each integration's workflows are doing in this environment. Open a row to start, inspect and manage its executions; pending tasks and reviews open in Human Tasks.
      </Typography>

      {deployedIds !== undefined && deployed.length > 0 && (
        <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
          <Typography variant="caption" sx={{ color: 'text.secondary', mr: 0.5 }}>
            Needs attention:
          </Typography>
          <Chip size="small" variant={offline > 0 ? 'filled' : 'outlined'} color={offline > 0 ? 'warning' : 'default'} label={`${offline} runtime${offline === 1 ? '' : 's'} offline`} />
          <Chip size="small" variant={failedTotal.count > 0 ? 'filled' : 'outlined'} color={failedTotal.count > 0 ? 'error' : 'default'} label={`${failedTotal.text} failed in 24h`} />
          {canSeeWork && <Chip size="small" variant={reviewsTotal.count > 0 ? 'filled' : 'outlined'} color={reviewsTotal.count > 0 ? 'primary' : 'default'} label={`${reviewsTotal.text} review${reviewsTotal.count === 1 ? '' : 's'} waiting`} />}
          {canSeeWork && <Chip size="small" variant={tasksTotal > 0 ? 'filled' : 'outlined'} color={tasksTotal > 0 ? 'primary' : 'default'} label={`${tasksPending ? '…' : tasksTotal} task${tasksTotal === 1 ? '' : 's'} waiting`} />}
        </Stack>
      )}

      <ListingTable>
        <ListingTable.Head>
          <ListingTable.Row>
            <HeaderCell label="Integration" help="A workflow integration in this project. Open it to work with its executions." />
            <HeaderCell label="Runtime" help="Whether the integration's runtime is heartbeating into the control plane right now, from its last heartbeat." />
            <HeaderCell label="Workflow Types" help="Workflow definitions this integration publishes, from its heartbeat metadata." />
            <HeaderCell label="Running" help="Instances currently executing or parked. A '+' means more than the first page." />
            <HeaderCell label="Suspended" help="Instances paused by an operator, waiting to be resumed." />
            <HeaderCell label="Failed (24h)" help="Instances that finished as FAILED in the last 24 hours." />
            <HeaderCell label="Completed (24h)" help="Instances that finished successfully in the last 24 hours." />
            {canSeeWork && <HeaderCell label="Pending Reviews" help="Review activities waiting for a decision — approval gates and failed-activity reviews. Decided in Human Tasks." />}
            {canSeeWork && <HeaderCell label="Pending Tasks" help="Human tasks waiting for anyone in any role — the project total, unlike the Human Tasks page, which shows only the work you can act on." />}
          </ListingTable.Row>
        </ListingTable.Head>
        <ListingTable.Body>
          {integrations.map((integration) => {
            const isDeployed = deployedIds?.has(integration.componentId);
            const runtime = runtimeByComponent.get(integration.componentId);
            const s = stats.get(integration.componentId) ?? {};
            const types = typesByComponent.get(integration.componentId);
            const clickable = isDeployed === true;
            return (
              <ListingTable.Row key={integration.componentId} hover={clickable} onClick={clickable ? () => openExecutions(integration) : undefined} sx={{ cursor: clickable ? 'pointer' : 'default' }}>
                <ListingTable.Cell>
                  <Stack direction="row" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
                    <Workflow size={16} />
                    <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {integration.name}
                    </Typography>
                  </Stack>
                </ListingTable.Cell>
                {isDeployed === undefined ? (
                  <ListingTable.Cell colSpan={canSeeWork ? 8 : 6}>
                    <Typography variant="caption" color="text.secondary">
                      Loading…
                    </Typography>
                  </ListingTable.Cell>
                ) : isDeployed === false ? (
                  // The rows are the project's components; deployment is per environment. Saying
                  // so beats a row of numbers that would never arrive.
                  <ListingTable.Cell colSpan={canSeeWork ? 8 : 6}>
                    <Typography variant="caption" color="text.disabled">
                      Not deployed in this environment.
                    </Typography>
                  </ListingTable.Cell>
                ) : (
                  <>
                    <ListingTable.Cell>
                      <Tooltip title={runtime?.lastHeartbeat ? `Last heartbeat ${new Date(runtime.lastHeartbeat).toLocaleString()}` : ''}>
                        <span>
                          <StatusChip status={runtime?.status ?? 'UNKNOWN'} />
                        </span>
                      </Tooltip>
                    </ListingTable.Cell>
                    <ListingTable.Cell>{definitions.isLoading && types === undefined ? '…' : (types ?? 0)}</ListingTable.Cell>
                    <ListingTable.Cell>{countText(s.running)}</ListingTable.Cell>
                    <ListingTable.Cell>{countText(s.suspended)}</ListingTable.Cell>
                    <ListingTable.Cell>
                      <Typography variant="body2" component="span" sx={{ color: s.failed && s.failed.count > 0 ? 'error.main' : 'inherit', fontWeight: s.failed && s.failed.count > 0 ? 600 : 400 }}>
                        {countText(s.failed)}
                      </Typography>
                    </ListingTable.Cell>
                    <ListingTable.Cell>{countText(s.completed)}</ListingTable.Cell>
                    {canSeeWork && (
                      <ListingTable.Cell>
                        {/* Reviews are decided in Human Tasks, so this number goes THERE. */}
                        <Typography
                          variant="body2"
                          component="span"
                          sx={{ textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                          onClick={(e) => {
                            e.stopPropagation();
                            openTasks(integration, 'reviews');
                          }}>
                          {countText(s.reviews)}
                        </Typography>
                      </ListingTable.Cell>
                    )}
                    {canSeeWork && (
                      <ListingTable.Cell>
                        <Typography
                          variant="body2"
                          component="span"
                          sx={{ textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                          onClick={(e) => {
                            e.stopPropagation();
                            openTasks(integration);
                          }}>
                          {numberText(s.tasks)}
                        </Typography>
                      </ListingTable.Cell>
                    )}
                  </>
                )}
              </ListingTable.Row>
            );
          })}
        </ListingTable.Body>
      </ListingTable>
    </Stack>
  );
}
