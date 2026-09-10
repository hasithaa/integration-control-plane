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
import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useProjectRuntimes, type GqlRuntime } from '../../api/queries';
import { fetchedAtOf, invalidateWorkflowQueries, isPreparing, isRefreshing, pendingWorkItemsQueryOptions, useWorkflowDefinitionsAcross, valueOf } from '../../api/workflows';
import { narrow, resourceUrl, type ProjectScope } from '../../nav';
import { formatClock, formatDistanceToNow } from '../../utils/time';
import { useTimeZone } from '../../contexts/TimeZoneContext';
import { ReviewActivityDetailDialog, type Toast } from './AdminPortal';
import { TaskDetailDialog, toWorkItem, WorkItemTable, type WorkItem } from './UserPortal';
import { HeaderCell } from './shared';
import type { WorkflowIntegrationEntry } from './useWorkflowPageScope';
import { countText, numberText, sumOf, totalOf, useIntegrationStats, useSinceWindow, type IntegrationStats } from './WorkflowStats';

/**
 * The project level. Listing every instance or task project-wide is impossible by construction —
 * integrations may run against different Temporal servers or namespaces, and no single runtime
 * can see the others' work — so the project shows a summary instead: one row per integration in
 * the selected environment, each figure one bounded request to that integration's runtime, and a
 * drill-down into the integration's own pages for the list behind any number.
 *
 * Executions: how is each integration's workflow doing right now — running, suspended, finished
 * how in the last day, and how much is waiting on a person.
 *
 * Human Tasks: everything waiting for ME across the project, as one queue. It is assembled from
 * one page per integration, so it says plainly which integrations it currently reflects and
 * which are still answering, offline or unreachable — a list built from several sources must
 * never look more complete than it is.
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
  const deployedIds = runtimes === undefined || runtimesPending ? undefined : new Set(runtimeByComponent.keys());
  if (integrations.length === 0) {
    return <Typography sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>No workflow integrations in this project yet. An integration that declares workflows appears here after its first heartbeat.</Typography>;
  }
  const common = { scope, environmentId, integrations, runtimeByComponent, deployedIds, canViewHumanTasks, canViewWorkflows };
  return resource === 'workflows' ? <WorkflowStatsTable {...common} /> : <ProjectInbox {...common} />;
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

interface TableProps {
  scope: ProjectScope;
  environmentId: string;
  integrations: WorkflowIntegrationEntry[];
  runtimeByComponent: Map<string, GqlRuntime>;
  /** Undefined while the environment's runtimes are still resolving. */
  deployedIds: Set<string> | undefined;
  canViewHumanTasks: boolean;
  canViewWorkflows: boolean;
}

/** The runtimes that are not heartbeating, from the heartbeat itself — known before any runtime has answered a question. */
const offlineCount = (deployed: WorkflowIntegrationEntry[], runtimeByComponent: Map<string, GqlRuntime>): number => deployed.filter((d) => (runtimeByComponent.get(d.componentId)?.status ?? '').toUpperCase() !== 'RUNNING').length;

const plural = (n: number, word: string): string => `${word}${n === 1 ? '' : 's'}`;

/** A number that leads somewhere: dotted underline, and the click does not also open the row. */
function LinkedCount({ text, onClick }: { text: string; onClick: () => void }): JSX.Element {
  return (
    <Typography
      variant="body2"
      component="span"
      sx={{ textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer', fontVariantNumeric: 'tabular-nums', '&:hover': { color: 'primary.main' } }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}>
      {text}
    </Typography>
  );
}

/**
 * The row shape both tables share: the integration's name, then either the figures or one note
 * spanning them — still resolving, not deployed here, or runtime offline. There is no runtime
 * column: a runtime's status is a fact about the runtime, shown where runtimes are managed, and
 * the only thing it changes here is whether figures can arrive at all. When they cannot, the row
 * says why instead of showing a line of dashes.
 */
function IntegrationRow({
  integration,
  isDeployed,
  runtime,
  span,
  onOpen,
  children,
}: {
  integration: WorkflowIntegrationEntry;
  isDeployed: boolean | undefined;
  runtime: GqlRuntime | undefined;
  /** How many columns the note covers: every figure. */
  span: number;
  onOpen: () => void;
  children: ReactNode;
}): JSX.Element {
  const clickable = isDeployed === true;
  const offline = isDeployed === true && (runtime?.status ?? '').toUpperCase() !== 'RUNNING';
  return (
    <ListingTable.Row hover={clickable} onClick={clickable ? onOpen : undefined} sx={{ cursor: clickable ? 'pointer' : 'default' }}>
      <ListingTable.Cell>
        <Stack direction="row" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
          <Workflow size={16} />
          <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {integration.name}
          </Typography>
        </Stack>
      </ListingTable.Cell>
      {isDeployed === undefined ? (
        <ListingTable.Cell colSpan={span}>
          <Typography variant="caption" color="text.secondary">
            Loading…
          </Typography>
        </ListingTable.Cell>
      ) : isDeployed === false ? (
        // The rows are the project's components; deployment is per environment. Saying so beats
        // a row of numbers that would never arrive.
        <ListingTable.Cell colSpan={span}>
          <Typography variant="caption" color="text.disabled">
            Not deployed in this environment.
          </Typography>
        </ListingTable.Cell>
      ) : offline ? (
        // The runtime answers every figure in this row; while it is not heartbeating there is
        // nothing to count, and the reason reads better than six dashes.
        <ListingTable.Cell colSpan={span}>
          <Typography variant="caption" color="warning.main">
            Runtime offline{runtime?.lastHeartbeat ? ` — last heartbeat ${formatDistanceToNow(runtime.lastHeartbeat)}` : ''}. Figures return when it heartbeats again.
          </Typography>
        </ListingTable.Cell>
      ) : (
        children
      )}
    </ListingTable.Row>
  );
}

// ── Workflow Executions ──

function WorkflowStatsTable({ scope, environmentId, integrations, runtimeByComponent, deployedIds, canViewHumanTasks, canViewWorkflows }: TableProps): JSX.Element {
  const navigate = useNavigate();
  const since = useSinceWindow();
  const deployed = useMemo(() => integrations.filter((i) => deployedIds?.has(i.componentId)), [integrations, deployedIds]);
  const canSeeWork = canViewHumanTasks || canViewWorkflows;
  const rows = useIntegrationStats(
    deployed.map((d) => ({ componentId: d.componentId, environmentId })),
    since,
    { instances: true, reviews: canSeeWork, tasks: canSeeWork, myTasks: false },
  );
  const statsByComponent = new Map<string, IntegrationStats>(deployed.map((d, i) => [d.componentId, rows[i]]));
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

  // The strip: what needs attention across the project.
  const offline = offlineCount(deployed, runtimeByComponent);
  const failedTotal = totalOf(rows, (s) => s.failed);
  const reviewsTotal = totalOf(rows, (s) => s.reviews);
  const tasksTotal = sumOf(rows, (s) => s.tasks);

  const openExecutions = (integration: WorkflowIntegrationEntry) => navigate(`${resourceUrl(narrow(scope, integration.routeHandler), 'workflows')}?env=${encodeURIComponent(environmentId)}`);
  const openTasks = (integration: WorkflowIntegrationEntry, tab?: 'reviews') => navigate(`${resourceUrl(narrow(scope, integration.routeHandler), 'tasks')}${tab ? `?tab=${tab}&` : '?'}env=${encodeURIComponent(environmentId)}`);

  return (
    <Stack gap={2}>
      <Typography variant="body2" color="text.secondary">
        Open an integration to start, inspect and manage its executions. Pending reviews and tasks open in Human Tasks.
      </Typography>

      {deployedIds !== undefined && deployed.length > 0 && (
        <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
          <Typography variant="caption" sx={{ color: 'text.secondary', mr: 0.5 }}>
            Needs attention:
          </Typography>
          <Chip size="small" variant={offline > 0 ? 'filled' : 'outlined'} color={offline > 0 ? 'warning' : 'default'} label={`${offline} ${plural(offline, 'runtime')} offline`} />
          <Chip size="small" variant={failedTotal.count > 0 ? 'filled' : 'outlined'} color={failedTotal.count > 0 ? 'error' : 'default'} label={`${failedTotal.text} failed in 24h`} />
          {canSeeWork && <Chip size="small" variant={reviewsTotal.count > 0 ? 'filled' : 'outlined'} color={reviewsTotal.count > 0 ? 'primary' : 'default'} label={`${reviewsTotal.text} ${plural(reviewsTotal.count, 'review')} waiting`} />}
          {canSeeWork && <Chip size="small" variant={tasksTotal.count > 0 ? 'filled' : 'outlined'} color={tasksTotal.count > 0 ? 'primary' : 'default'} label={`${tasksTotal.text} ${plural(tasksTotal.count, 'task')} waiting`} />}
        </Stack>
      )}

      <ListingTable>
        <ListingTable.Head>
          <ListingTable.Row>
            <HeaderCell label="Integration" help="A workflow integration in this project. Open it to work with its executions." />
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
            const s = statsByComponent.get(integration.componentId) ?? {};
            const types = typesByComponent.get(integration.componentId);
            return (
              <IntegrationRow key={integration.componentId} integration={integration} isDeployed={deployedIds?.has(integration.componentId)} runtime={runtimeByComponent.get(integration.componentId)} span={canSeeWork ? 7 : 5} onOpen={() => openExecutions(integration)}>
                <ListingTable.Cell>{definitions.isLoading && types === undefined ? '…' : (types ?? 0)}</ListingTable.Cell>
                <ListingTable.Cell>{countText(s.running)}</ListingTable.Cell>
                <ListingTable.Cell>{countText(s.suspended)}</ListingTable.Cell>
                <ListingTable.Cell>
                  <Typography variant="body2" component="span" sx={{ color: s.failed && s.failed.count > 0 ? 'error.main' : 'inherit', fontWeight: s.failed && s.failed.count > 0 ? 600 : 400 }}>
                    {countText(s.failed)}
                  </Typography>
                </ListingTable.Cell>
                <ListingTable.Cell>{countText(s.completed)}</ListingTable.Cell>
                {/* Reviews and tasks are decided in Human Tasks, so those numbers go THERE. */}
                {canSeeWork && (
                  <ListingTable.Cell>
                    <LinkedCount text={countText(s.reviews)} onClick={() => openTasks(integration, 'reviews')} />
                  </ListingTable.Cell>
                )}
                {canSeeWork && (
                  <ListingTable.Cell>
                    <LinkedCount text={numberText(s.tasks)} onClick={() => openTasks(integration)} />
                  </ListingTable.Cell>
                )}
              </IntegrationRow>
            );
          })}
        </ListingTable.Body>
      </ListingTable>
    </Stack>
  );
}

// ── Human Tasks: the project inbox ──

/** One integration's contribution to the inbox, and how far along it is. */
interface SourceState {
  integration: WorkflowIntegrationEntry;
  status: 'offline' | 'fetching' | 'refreshing' | 'ready' | 'failed';
  count: number;
  fetchedAt?: number;
}

const joinNames = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * Every pending task and review the caller can act on, from every integration in the
 * environment, as one queue — oldest first, because the item someone has waited longest on is
 * the one to open next. No single runtime can list this: each integration answers for itself,
 * so the inbox asks each one for a page and merges them here.
 *
 * That is also why it has to be honest about itself. The sources answer at different moments —
 * one integration's runtime may be offline, another still preparing its page — so the queue can
 * grow while it is being read. The strip above the list names each integration with its state
 * (how many it contributed, still answering, offline, unreachable) and the line under the title
 * says how many sources the list currently reflects. Oldest-first keeps the changes calm: an
 * integration answering late adds rows at the bottom, and a decided item simply leaves.
 *
 * No bulk actions here: a decision is made one item at a time, in the drawer of the integration
 * that owns it.
 */
function ProjectInbox({ scope, environmentId, integrations, runtimeByComponent, deployedIds }: TableProps): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { zone } = useTimeZone();
  const [toast, setToast] = useState<Toast>(null);
  const [openTask, setOpenTask] = useState<WorkItem | null>(null);
  const [openReview, setOpenReview] = useState<WorkItem | null>(null);

  const deployed = useMemo(() => integrations.filter((i) => deployedIds?.has(i.componentId)), [integrations, deployedIds]);
  // An offline runtime cannot answer; asking it only produces an error to explain. Its row in the
  // strip says why it is missing instead.
  const online = (d: WorkflowIntegrationEntry) => (runtimeByComponent.get(d.componentId)?.status ?? '').toUpperCase() === 'RUNNING';
  const results = useQueries({
    queries: deployed.map((d) => ({ ...pendingWorkItemsQueryOptions({ componentId: d.componentId, environmentId }), enabled: online(d) })),
  });

  const { items, labels, sources } = useMemo(() => {
    const merged: WorkItem[] = [];
    const labels = new Map<string, string>();
    const sources: SourceState[] = [];
    deployed.forEach((d, i) => {
      const r = results[i];
      labels.set(d.componentId, d.name);
      const rows = valueOf(r?.data)?.items ?? [];
      let status: SourceState['status'] = 'ready';
      if (!online(d)) status = 'offline';
      else if (r?.error) status = 'failed';
      else if (r?.isPending || isPreparing(r?.data)) status = 'fetching';
      else if (isRefreshing(r?.data)) status = 'refreshing';
      sources.push({ integration: d, status, count: rows.length, fetchedAt: fetchedAtOf(r?.data) });
      if (status === 'offline' || status === 'failed') return;
      for (const row of rows) {
        const item = toWorkItem(row);
        item.componentId = d.componentId;
        if (item.taskQueue) labels.set(item.taskQueue, d.name);
        else item.taskQueue = d.componentId;
        merged.push(item);
      }
    });
    // Oldest first — ISO-8601 sorts lexicographically. Items without a time sink to the end.
    merged.sort((a, b) => (a.startTime ?? '\uffff').localeCompare(b.startTime ?? '\uffff'));
    return { items: merged, labels, sources };
    // `results` is a fresh array each render; recomputing is cheap and keeps the list current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployed, runtimeByComponent, ...results.map((r) => r.data), ...results.map((r) => r.error), ...results.map((r) => r.isPending)]);

  const answered = sources.filter((s) => s.status === 'ready' || s.status === 'refreshing');
  const answering = sources.filter((s) => s.status === 'fetching');
  const offline = sources.filter((s) => s.status === 'offline');
  const failed = sources.filter((s) => s.status === 'failed');
  const resolving = deployedIds === undefined;
  const undeployed = resolving ? 0 : integrations.length - deployed.length;
  const tasks = items.filter((w) => w.kind === 'task').length;
  const reviews = items.length - tasks;

  // The line that says what the list is: how much, from how many of the sources, and what is
  // missing. Written from the states rather than assumed, so it is never more confident than
  // the data behind it.
  const summary = (() => {
    if (resolving) return 'Finding the integrations deployed in this environment…';
    if (deployed.length === 0) return 'No workflow integration is deployed in this environment.';
    const parts: string[] = [];
    parts.push(`Showing ${items.length} item${items.length === 1 ? '' : 's'} — ${tasks} task${tasks === 1 ? '' : 's'}, ${reviews} review${reviews === 1 ? '' : 's'} — from ${answered.length} of ${deployed.length} integration${deployed.length === 1 ? '' : 's'}.`);
    if (answering.length) parts.push(`${joinNames(answering.map((s) => s.integration.name))} ${answering.length === 1 ? 'is' : 'are'} still answering; ${answering.length === 1 ? 'its' : 'their'} work joins the list as it arrives.`);
    if (offline.length) parts.push(`${joinNames(offline.map((s) => s.integration.name))} ${offline.length === 1 ? 'is' : 'are'} offline — ${offline.length === 1 ? 'its' : 'their'} tasks are not included.`);
    if (failed.length) parts.push(`${joinNames(failed.map((s) => s.integration.name))} could not be reached — ${failed.length === 1 ? 'its' : 'their'} tasks are not included.`);
    return parts.join(' ');
  })();

  const refresh = () => invalidateWorkflowQueries(queryClient, environmentId);
  const openQueue = (integration: WorkflowIntegrationEntry) => navigate(`${resourceUrl(narrow(scope, integration.routeHandler), 'tasks')}?env=${encodeURIComponent(environmentId)}`);

  const sourceChip = (s: SourceState) => {
    const name = s.integration.name;
    const updated = s.fetchedAt ? `updated ${formatClock(s.fetchedAt * 1000, { zone })}` : '';
    switch (s.status) {
      case 'ready':
        return { label: `${name} · ${s.count}`, color: 'default' as const, variant: 'outlined' as const, tip: `${s.count} pending from ${name}${updated ? ` — ${updated}` : ''}. Open its queue.` };
      case 'refreshing':
        return { label: `${name} · ${s.count} · updating…`, color: 'default' as const, variant: 'outlined' as const, tip: `${name} answered ${updated}; a fresh copy is on its way after a change.` };
      case 'fetching':
        return { label: `${name} · answering…`, color: 'default' as const, variant: 'outlined' as const, tip: `${name}'s runtime is preparing its list. Its items join the queue when it answers.` };
      case 'offline':
        return { label: `${name} · offline`, color: 'warning' as const, variant: 'filled' as const, tip: `${name}'s runtime is not heartbeating. Its tasks are not in this list until it is back.` };
      case 'failed':
        return { label: `${name} · unreachable`, color: 'error' as const, variant: 'filled' as const, tip: `${name} did not answer. Its tasks are not in this list.` };
    }
  };

  return (
    <Stack gap={2}>
      <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
        {answering.length > 0 && <CircularProgress size={14} />}
        <Typography variant="body2" color="text.secondary">
          {summary}
          {undeployed > 0 ? ` ${undeployed} integration${undeployed === 1 ? ' is' : 's are'} not deployed in this environment.` : ''}
        </Typography>
      </Stack>

      {/* The sources: one chip per integration, its state in words, its queue one click away. */}
      {sources.length > 0 && (
        <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
          <Typography variant="caption" sx={{ color: 'text.secondary', mr: 0.5 }}>
            Sources:
          </Typography>
          {sources.map((s) => {
            const c = sourceChip(s);
            return (
              <Tooltip key={s.integration.componentId} title={c.tip}>
                <Chip size="small" variant={c.variant} color={c.color} label={c.label} onClick={() => openQueue(s.integration)} sx={{ cursor: 'pointer' }} />
              </Tooltip>
            );
          })}
        </Stack>
      )}

      {resolving || (items.length === 0 && answering.length > 0) ? (
        <CircularProgress size={24} sx={{ display: 'block', mx: 'auto', py: 4 }} />
      ) : items.length === 0 ? (
        <Typography sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
          {answered.length === 0 ? 'No integration could be asked for its tasks right now.' : `Nothing is waiting for you across ${answered.length === 1 ? 'this integration' : `these ${answered.length} integrations`}.`}
        </Typography>
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
          onClose={() => {
            setOpenTask(null);
            refresh();
          }}
          onToast={setToast}
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
