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

import { Box, Card, CardActionArea, Chip, Stack, Typography } from '@wso2/oxygen-ui';
import { UserCheck, Workflow } from '@wso2/oxygen-ui-icons-react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { usePendingReviewActivityCount, usePendingTaskCount, useWorkflowDefinitionsAcross, valueOf } from '../../api/workflows';
import { narrow, resourceUrl, type ProjectScope } from '../../nav';
import type { WorkflowIntegrationEntry } from './useWorkflowPageScope';

/**
 * The project level as a dashboard: one card per workflow integration, with its pending work,
 * opening that integration's own pages.
 *
 * This replaces the aggregated project-wide listing on purpose. That listing only ever worked
 * when every integration shared one Temporal namespace, and even then it was served by whichever
 * integration happened to sort first as the gateway — whose runtime scoped the answer to its own
 * task queue, so the "project" list silently showed one integration's work. Integrations on
 * different Temporal servers or namespaces make a unified list impossible by construction: no
 * single runtime can see the others' instances. Listing is per integration; this page is how a
 * project selects one, without losing sight of where the work is.
 */
export default function ProjectWorkflowDashboard({
  scope,
  environmentId,
  integrations,
  resource,
  canViewHumanTasks,
  canViewWorkflows,
}: {
  scope: ProjectScope;
  environmentId: string;
  integrations: WorkflowIntegrationEntry[];
  resource: 'tasks' | 'workflows';
  canViewHumanTasks: boolean;
  canViewWorkflows: boolean;
}): JSX.Element {
  if (integrations.length === 0) {
    return <Typography sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>No workflow integrations in this project yet. An integration that declares workflows appears here after its first heartbeat.</Typography>;
  }
  return (
    <Stack gap={2}>
      <Typography variant="body2" color="text.secondary">
        Workflow work is listed per integration — each runs against its own Temporal task queue. Pick an integration to see its {resource === 'tasks' ? 'tasks' : 'executions'}. Counts show work applicable to you; pending tasks and reviews open in Human Tasks.
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2 }}>
        {integrations.map((integration) => (
          <IntegrationCard key={integration.componentId} scope={scope} environmentId={environmentId} integration={integration} resource={resource} canViewHumanTasks={canViewHumanTasks} canViewWorkflows={canViewWorkflows} />
        ))}
      </Box>
    </Stack>
  );
}

function IntegrationCard({
  scope,
  environmentId,
  integration,
  resource,
  canViewHumanTasks,
  canViewWorkflows,
}: {
  scope: ProjectScope;
  environmentId: string;
  integration: WorkflowIntegrationEntry;
  resource: 'tasks' | 'workflows';
  canViewHumanTasks: boolean;
  canViewWorkflows: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  // Component-scoped counts: the server narrows each to that integration's own published queue,
  // so these are correct whatever namespace or Temporal server the integration runs against.
  // Each page's dashboard shows its own facts — tasks for the Human Tasks page, workflow types
  // and reviews for Executions — rather than one card pretending to serve both.
  const componentScope = { componentId: integration.componentId, environmentId };
  const forTasks = resource === 'tasks';
  const { data: tasksResult } = usePendingTaskCount(componentScope, undefined, forTasks && canViewHumanTasks);
  const { data: reviewsResult } = usePendingReviewActivityCount(componentScope, undefined, canViewWorkflows);
  // Definitions come from stored heartbeat metadata — no call into the runtime.
  const definitions = useWorkflowDefinitionsAcross(forTasks ? [] : [{ componentId: integration.componentId, componentName: integration.name, handler: integration.routeHandler }], environmentId);
  const pendingTasks = valueOf(tasksResult);
  const pendingReviews = valueOf(reviewsResult);
  const pending = (forTasks ? (pendingTasks ?? 0) : 0) + (pendingReviews?.count ?? 0);

  return (
    <Card variant="outlined">
      <CardActionArea onClick={() => navigate(`${resourceUrl(narrow(scope, integration.routeHandler), resource)}?env=${encodeURIComponent(environmentId)}`)} sx={{ p: 2, height: '100%' }}>
        <Stack gap={1}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
            <Stack direction="row" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
              <Workflow size={16} />
              <Typography variant="subtitle2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {integration.name}
              </Typography>
            </Stack>
            {pending > 0 && <Chip size="small" color="primary" label={pending} />}
          </Stack>
          <Stack direction="row" gap={2}>
            {forTasks && canViewHumanTasks && (
              <Stack direction="row" alignItems="center" gap={0.5} sx={{ color: 'text.secondary' }}>
                <UserCheck size={13} />
                <Typography variant="caption">
                  {pendingTasks ?? '…'} pending task{pendingTasks === 1 ? '' : 's'}
                </Typography>
              </Stack>
            )}
            {!forTasks && (
              <Typography variant="caption" color="text.secondary">
                {definitions.isLoading ? '…' : definitions.items.length} workflow type{definitions.items.length === 1 ? '' : 's'}
              </Typography>
            )}
            {canViewWorkflows && (
              // Reviews are decided in Human Tasks, so this number goes THERE — following it to
              // the executions list left the reader hunting for rows that page does not show.
              <Typography
                variant="caption"
                sx={{ color: 'text.secondary', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`${resourceUrl(narrow(scope, integration.routeHandler), 'tasks')}?tab=reviews&env=${encodeURIComponent(environmentId)}`);
                }}>
                {pendingReviews ? `${pendingReviews.count}${pendingReviews.capped ? '+' : ''}` : '…'} pending review{pendingReviews?.count === 1 ? '' : 's'}
              </Typography>
            )}
          </Stack>
        </Stack>
      </CardActionArea>
    </Card>
  );
}
