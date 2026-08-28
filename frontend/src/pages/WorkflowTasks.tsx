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

import { useState, type JSX } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import NotFound from '../components/NotFound';
import ProjectWorkflowDashboard from '../components/workflow/ProjectWorkflowDashboard';
import UserPortal from '../components/workflow/UserPortal';
import WorkflowPageFrame from '../components/workflow/WorkflowPageFrame';
import { useWorkflowPageScope } from '../components/workflow/useWorkflowPageScope';
import { resourceUrl, broaden, hasComponent, type ComponentScope, type ProjectScope } from '../nav';

/**
 * The person's own workflow work: human tasks assigned to their roles, and review activities
 * awaiting their decision. Split out of the executions page so someone working through their queue
 * is not one navigation away from losing their place — the two views are different activities done
 * at different rhythms, and each now survives leaving and coming back on its own.
 */
export default function WorkflowTasks(scope: ComponentScope | ProjectScope): JSX.Element {
  const componentLevel = hasComponent(scope);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedEnvId, setSelectedEnvId] = useState(searchParams.get('env') ?? '');

  const pageScope = useWorkflowPageScope(scope, selectedEnvId);
  const { environments, activeEnvId, targets, taskQueue, component, project, canViewHumanTasks, canViewWorkflows, workflowIntegrations, soleWorkflowIntegration } = pageScope;
  // The project level lists per integration: with several workflow integrations this page is a
  // dashboard that selects one; with exactly one it behaves as that integration.
  const dashboard = !componentLevel && !soleWorkflowIntegration;

  // One queue now holds both kinds of work; an old ?tab=reviews link presets the type filter.
  // Tasks are gated on the human-task permissions; reviews are human decisions too, so either
  // domain shows them (the proxy authorizes /review-activities for both) — each source shows
  // only to those allowed.
  const initialKind = searchParams.get('tab') === 'reviews' ? ('reviews' as const) : undefined;
  void setSearchParams;
  const permitted = canViewHumanTasks || canViewWorkflows;

  if (!pageScope.loading && componentLevel && !component) {
    return <NotFound message="Component not found" backTo={resourceUrl(broaden(scope)!, 'overview')} backLabel="Back to Project" />;
  }

  return (
    <WorkflowPageFrame
      title="Human Tasks"
      description={
        componentLevel ? (
          <>
            Complete human tasks — including review activities — for <strong>{component?.displayName ?? scope.component}</strong>. Only tasks applicable to you are shown.
          </>
        ) : (
          <>
            {dashboard ? (
              <>
                Human tasks in <strong>{project?.name ?? scope.project}</strong> are listed per integration. Only work applicable to you is counted and shown.
              </>
            ) : (
              <>
                Complete human tasks — including review activities — for <strong>{soleWorkflowIntegration?.name ?? project?.name ?? scope.project}</strong>. Only tasks applicable to you are shown.
              </>
            )}
          </>
        )
      }
      loading={pageScope.loading}
      environments={environments}
      activeEnvId={activeEnvId}
      onEnvChange={setSelectedEnvId}
      permitted={permitted}
      noPermissionMessage={componentLevel ? 'You do not have permission to view tasks for this integration.' : 'You do not have permission to view tasks for this project.'}>
      {permitted &&
        (dashboard ? (
          <ProjectWorkflowDashboard scope={scope as ProjectScope} projectId={pageScope.projectId} environmentId={activeEnvId} integrations={workflowIntegrations} resource="tasks" canViewHumanTasks={canViewHumanTasks} canViewWorkflows={canViewWorkflows} />
        ) : (
          <UserPortal
            targets={targets}
            environmentId={activeEnvId}
            taskQueue={taskQueue}
            canViewTasks={canViewHumanTasks}
            canViewReviews={canViewHumanTasks || canViewWorkflows}
            initialKind={initialKind}
            initialTaskId={searchParams.get('task') ?? undefined}
            initialReviewId={searchParams.get('review') ?? undefined}
            // The queue's own list needs a refresh cycle before it reflects a decision; the
            // executions list shows the consequence at once, so completion lands there — but
            // only for someone allowed to see it. Others keep the in-place confirmation.
            onTaskDecided={canViewWorkflows ? (message) => navigate(`${resourceUrl(scope, 'workflows')}?env=${encodeURIComponent(activeEnvId)}`, { state: { toast: message } }) : undefined}
          />
        ))}
    </WorkflowPageFrame>
  );
}
