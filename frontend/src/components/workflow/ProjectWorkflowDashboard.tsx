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

import { Chip, ListingTable, Stack, Tooltip, Typography } from '@wso2/oxygen-ui';
import { Workflow } from '@wso2/oxygen-ui-icons-react';
import { useMemo, type JSX, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useProjectRuntimes, type GqlRuntime } from '../../api/queries';
import { useWorkflowDefinitionsAcross } from '../../api/workflows';
import { narrow, resourceUrl, type ProjectScope } from '../../nav';
import { HeaderCell, StatusChip } from './shared';
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
 * Human Tasks: how much is waiting for ME in each integration, and where to go to decide it. A
 * merged inbox was tried and dropped: it needed every integration's runtime to answer before the
 * list was whole, so one missing heartbeat left a list that looked complete and was not. Rows
 * fail one at a time; a summary table can say "—" for one integration and stay honest.
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
  return resource === 'workflows' ? <WorkflowStatsTable {...common} /> : <TaskStatsTable {...common} />;
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
 * The row shape both tables share: the integration's name, then either a note spanning the
 * figures (still resolving, or not deployed here) or the runtime's status followed by the cells.
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
  /** How many columns the note covers: the runtime column plus every figure. */
  span: number;
  onOpen: () => void;
  children: ReactNode;
}): JSX.Element {
  const clickable = isDeployed === true;
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
      ) : (
        <>
          <ListingTable.Cell>
            <Tooltip title={runtime?.lastHeartbeat ? `Last heartbeat ${new Date(runtime.lastHeartbeat).toLocaleString()}` : ''}>
              <span>
                <StatusChip status={runtime?.status ?? 'UNKNOWN'} />
              </span>
            </Tooltip>
          </ListingTable.Cell>
          {children}
        </>
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
        How each integration's workflows are doing in this environment. Open a row to start, inspect and manage its executions; pending tasks and reviews open in Human Tasks.
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
            const s = statsByComponent.get(integration.componentId) ?? {};
            const types = typesByComponent.get(integration.componentId);
            return (
              <IntegrationRow key={integration.componentId} integration={integration} isDeployed={deployedIds?.has(integration.componentId)} runtime={runtimeByComponent.get(integration.componentId)} span={canSeeWork ? 8 : 6} onOpen={() => openExecutions(integration)}>
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

// ── Human Tasks ──

/**
 * What is waiting for the caller in each integration: their own pending tasks (the runtime
 * already scopes that count to their roles), the reviews awaiting anyone's decision, and — for
 * someone who oversees workflows — the integration's total so they can see work that is waiting
 * on other people. A row opens that integration's queue, where the deciding happens.
 */
function TaskStatsTable({ scope, environmentId, integrations, runtimeByComponent, deployedIds, canViewHumanTasks, canViewWorkflows }: TableProps): JSX.Element {
  const navigate = useNavigate();
  const since = useSinceWindow();
  const deployed = useMemo(() => integrations.filter((i) => deployedIds?.has(i.componentId)), [integrations, deployedIds]);
  const rows = useIntegrationStats(
    deployed.map((d) => ({ componentId: d.componentId, environmentId })),
    since,
    { instances: false, reviews: true, tasks: canViewWorkflows, myTasks: canViewHumanTasks },
  );
  const statsByComponent = new Map<string, IntegrationStats>(deployed.map((d, i) => [d.componentId, rows[i]]));

  const offline = offlineCount(deployed, runtimeByComponent);
  const mine = sumOf(rows, (s) => s.myTasks);
  const reviewsTotal = totalOf(rows, (s) => s.reviews);
  const undeployed = deployedIds === undefined ? 0 : integrations.length - deployed.length;
  // Columns after Runtime, for the note rows to span.
  const figures = 1 + (canViewHumanTasks ? 1 : 0) + (canViewWorkflows ? 1 : 0);

  const openQueue = (integration: WorkflowIntegrationEntry, tab?: 'reviews') => navigate(`${resourceUrl(narrow(scope, integration.routeHandler), 'tasks')}${tab ? `?tab=${tab}&` : '?'}env=${encodeURIComponent(environmentId)}`);

  return (
    <Stack gap={2}>
      <Typography variant="body2" color="text.secondary">
        How much is waiting in each integration in this environment. Open a row for that integration's queue, where tasks and reviews are decided.
      </Typography>

      {deployedIds !== undefined && deployed.length > 0 && (
        <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
          <Chip size="small" variant={offline > 0 ? 'filled' : 'outlined'} color={offline > 0 ? 'warning' : 'default'} label={`${offline} ${plural(offline, 'runtime')} offline`} />
          {canViewHumanTasks && <Chip size="small" variant={mine.count > 0 ? 'filled' : 'outlined'} color={mine.count > 0 ? 'primary' : 'default'} label={`${mine.text} ${plural(mine.count, 'task')} for you`} />}
          <Chip size="small" variant={reviewsTotal.count > 0 ? 'filled' : 'outlined'} color={reviewsTotal.count > 0 ? 'primary' : 'default'} label={`${reviewsTotal.text} ${plural(reviewsTotal.count, 'review')} waiting`} />
          {undeployed > 0 && (
            <Typography variant="caption" color="text.disabled">
              {undeployed} {plural(undeployed, 'integration')} not deployed in this environment.
            </Typography>
          )}
        </Stack>
      )}

      <ListingTable>
        <ListingTable.Head>
          <ListingTable.Row>
            <HeaderCell label="Integration" help="A workflow integration in this project. Open it for its queue." />
            <HeaderCell label="Runtime" help="Whether the integration's runtime is heartbeating into the control plane right now. An offline runtime cannot report its work; its figures show as —." />
            {canViewHumanTasks && <HeaderCell label="Tasks for You" help="Pending human tasks assigned to a role you hold — the ones you can complete." />}
            <HeaderCell label="Pending Reviews" help="Review activities waiting for a decision — approval gates and failed-activity reviews." />
            {canViewWorkflows && <HeaderCell label="All Pending Tasks" help="Pending human tasks for anyone in any role — the integration's total, including work waiting on other people." />}
          </ListingTable.Row>
        </ListingTable.Head>
        <ListingTable.Body>
          {integrations.map((integration) => {
            const s = statsByComponent.get(integration.componentId) ?? {};
            return (
              <IntegrationRow key={integration.componentId} integration={integration} isDeployed={deployedIds?.has(integration.componentId)} runtime={runtimeByComponent.get(integration.componentId)} span={1 + figures} onOpen={() => openQueue(integration)}>
                {canViewHumanTasks && (
                  <ListingTable.Cell>
                    <Typography variant="body2" component="span" sx={{ fontWeight: s.myTasks && s.myTasks > 0 ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}>
                      {numberText(s.myTasks)}
                    </Typography>
                  </ListingTable.Cell>
                )}
                <ListingTable.Cell>
                  <LinkedCount text={countText(s.reviews)} onClick={() => openQueue(integration, 'reviews')} />
                </ListingTable.Cell>
                {canViewWorkflows && <ListingTable.Cell>{numberText(s.tasks)}</ListingTable.Cell>}
              </IntegrationRow>
            );
          })}
        </ListingTable.Body>
      </ListingTable>
    </Stack>
  );
}
