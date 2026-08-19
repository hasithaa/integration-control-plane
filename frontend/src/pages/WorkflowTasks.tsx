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

import { Box, Chip, Stack, Tab, Tabs } from '@wso2/oxygen-ui';
import { useState, type JSX } from 'react';
import { useSearchParams } from 'react-router';
import { usePendingReviewActivityCount, usePendingTaskCount } from '../api/workflows';
import NotFound from '../components/NotFound';
import UserPortal from '../components/workflow/UserPortal';
import WorkflowPageFrame from '../components/workflow/WorkflowPageFrame';
import { gatewayScope } from '../components/workflow/helpers';
import { useWorkflowPageScope } from '../components/workflow/useWorkflowPageScope';
import { resourceUrl, broaden, hasComponent, type ComponentScope, type ProjectScope } from '../nav';

/**
 * Tab title with the amount of work waiting behind it. Omitted at zero, and while the count is
 * still loading, so a tab only grows a badge when there is something to act on.
 */
function TabLabel({ title, count, capped }: { title: string; count?: number; capped?: boolean }): JSX.Element {
  return (
    <Stack direction="row" alignItems="center" gap={0.75}>
      <span>{title}</span>
      {count !== undefined && count > 0 && <Chip label={capped ? `${count}+` : count} size="small" color="primary" sx={{ height: 18, fontSize: 11, fontWeight: 600, '& .MuiChip-label': { px: 0.75 } }} />}
    </Stack>
  );
}

/**
 * The person's own workflow work: human tasks assigned to their roles, and review activities
 * awaiting their decision. Split out of the executions page so someone working through their queue
 * is not one navigation away from losing their place — the two views are different activities done
 * at different rhythms, and each now survives leaving and coming back on its own.
 */
export default function WorkflowTasks(scope: ComponentScope | ProjectScope): JSX.Element {
  const componentLevel = hasComponent(scope);
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedEnvId, setSelectedEnvId] = useState(searchParams.get('env') ?? '');

  const pageScope = useWorkflowPageScope(scope, selectedEnvId);
  const { environments, targets, taskQueue, component, project, canViewHumanTasks, canViewWorkflows } = pageScope;
  const activeEnvId = environments.some((e) => e.id === selectedEnvId) ? selectedEnvId : (environments[0]?.id ?? '');

  // The tab is URL-driven so links land deterministically ("reviews" from a review notification).
  const requestedTab = searchParams.get('tab');
  const wantedTab: 'tasks' | 'reviews' = requestedTab === 'reviews' ? 'reviews' : 'tasks';
  // Resolve the requested tab to one the user may see. Reviews is gated on the workflow
  // permissions (the proxy authorizes /review-activities on that branch), tasks on the human-task
  // ones — so either tab may be the only one on offer.
  const allowed: Record<'tasks' | 'reviews', boolean> = { tasks: canViewHumanTasks, reviews: canViewWorkflows };
  const activeTab: 'tasks' | 'reviews' | null = allowed[wantedTab] ? wantedTab : allowed.tasks ? 'tasks' : allowed.reviews ? 'reviews' : null;
  const setTab = (v: 'tasks' | 'reviews') =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', v);
        return next;
      },
      { replace: true },
    );

  // Badge counts poll, so each is skipped when its tab is not on offer. Both read through the same
  // gateway runtime the views themselves use, narrowed to this integration's queue when there is one.
  const gateway = gatewayScope({ targets, environmentId: activeEnvId, taskQueue });
  const { data: pendingTasks } = usePendingTaskCount(gateway, taskQueue, allowed.tasks);
  const { data: pendingReviews } = usePendingReviewActivityCount(gateway, taskQueue, allowed.reviews);

  if (!pageScope.loading && componentLevel && !component) {
    return <NotFound message="Component not found" backTo={resourceUrl(broaden(scope)!, 'overview')} backLabel="Back to Project" />;
  }

  return (
    <WorkflowPageFrame
      title="My Tasks"
      description={
        componentLevel ? (
          <>
            Complete human tasks and decide review activities for <strong>{component?.displayName ?? scope.component}</strong>.
          </>
        ) : (
          <>
            Complete human tasks and decide review activities across all integrations in <strong>{project?.name ?? scope.project}</strong>.
          </>
        )
      }
      loading={pageScope.loading}
      environments={environments}
      activeEnvId={activeEnvId}
      onEnvChange={setSelectedEnvId}
      permitted={activeTab !== null}
      noPermissionMessage={componentLevel ? 'You do not have permission to view tasks for this integration.' : 'You do not have permission to view tasks for this project.'}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={activeTab} onChange={(_, v) => setTab(v as 'tasks' | 'reviews')}>
          {allowed.tasks && <Tab label={<TabLabel title="My Tasks" count={pendingTasks} />} value="tasks" />}
          {allowed.reviews && <Tab label={<TabLabel title="Review Activities" count={pendingReviews?.count} capped={pendingReviews?.capped} />} value="reviews" />}
        </Tabs>
      </Box>
      {activeTab && <UserPortal targets={targets} environmentId={activeEnvId} taskQueue={taskQueue} view={activeTab} />}
    </WorkflowPageFrame>
  );
}
