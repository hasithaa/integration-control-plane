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

import { useEffect, useState, type JSX } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import NotFound from '../components/NotFound';
import ProjectWorkflowDashboard from '../components/workflow/ProjectWorkflowDashboard';
import AdminPortal from '../components/workflow/AdminPortal';
import WorkflowPageFrame from '../components/workflow/WorkflowPageFrame';
import { useWorkflowPageScope } from '../components/workflow/useWorkflowPageScope';
import { gatewayScope } from '../components/workflow/helpers';
import { valueOf, useWorkflowInfo } from '../api/workflows';
import { resourceUrl, broaden, hasComponent, type ComponentScope, type ProjectScope } from '../nav';

/**
 * Workflow executions: the operator's view of what ran and is running. A person's own work — tasks
 * to complete, reviews to decide — is a different activity with a different rhythm, so it lives on
 * its own page (My Tasks) rather than behind a tab here; links written when the two shared this
 * page (`?tab=tasks|reviews`) are redirected there.
 */
export default function Workflows(scope: ComponentScope | ProjectScope): JSX.Element {
  const componentLevel = hasComponent(scope);
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedEnvId, setSelectedEnvId] = useState(searchParams.get('env') ?? '');

  // Deep-link params (from the Overview page's "View Workflows", the start-workflow success dialog,
  // or a task's workflow link). Held in state rather than read from the URL on every render: the
  // portal re-seeds its filters from these on mount, so leaving them live in the URL would reapply
  // a search the user had since cleared.
  const [deepLink, setDeepLink] = useState<{ workflowType?: string; workflowId?: string }>(() => ({
    workflowType: searchParams.get('type') ?? undefined,
    workflowId: searchParams.get('workflowId') ?? undefined,
  }));
  const urlWorkflowType = searchParams.get('type');
  const urlWorkflowId = searchParams.get('workflowId');
  // A deep link can also arrive without remounting this page — "View Instance" from the start
  // dialog navigates to these same params — so pick those up when they appear.
  useEffect(() => {
    if (urlWorkflowType === null && urlWorkflowId === null) return;
    setDeepLink({ workflowType: urlWorkflowType ?? undefined, workflowId: urlWorkflowId ?? undefined });
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('type');
        next.delete('workflowId');
        return next;
      },
      { replace: true },
    );
  }, [urlWorkflowType, urlWorkflowId, setSearchParams]);

  const pageScope = useWorkflowPageScope(scope, selectedEnvId);
  const { environments, activeEnvId, targets, taskQueue, component, project, workflowIntegrations, soleWorkflowIntegration, canViewHumanTasks, canViewWorkflows } = pageScope;
  // Same rule as the tasks page: several workflow integrations make the project level a
  // dashboard; exactly one makes the page behave as that integration.
  const dashboard = !componentLevel && !soleWorkflowIntegration;

  // A deep-linked id might not be a workflow at all — a human task and a review are their own
  // instances. Ask the instance what it is (its starter stamped the kind in its memo) and load
  // the respective UI, rather than parsing the id's prefix here.
  const gatewayForResolve = gatewayScope({ targets, environmentId: activeEnvId });
  const { data: linkedInfo } = useWorkflowInfo(gatewayForResolve, deepLink.workflowId ?? null);
  const navigate = useNavigate();
  useEffect(() => {
    const kind = (valueOf(linkedInfo)?.kind ?? '').toUpperCase();
    if (!deepLink.workflowId || (kind !== 'HUMAN_TASK' && kind !== 'REVIEW_ACTIVITY')) return;
    const params = new URLSearchParams(kind === 'HUMAN_TASK' ? { tab: 'tasks', task: deepLink.workflowId } : { tab: 'reviews', review: deepLink.workflowId });
    if (activeEnvId) params.set('env', activeEnvId);
    navigate(`${resourceUrl(scope, 'tasks')}?${params}`, { replace: true });
  }, [linkedInfo, deepLink.workflowId, activeEnvId, navigate, scope]);

  // This page used to also hold My Tasks and Review Activities as tabs; send those bookmarks to
  // the page they became.
  const requestedTab = searchParams.get('tab');
  if (requestedTab === 'tasks' || requestedTab === 'reviews') {
    const params = new URLSearchParams({ tab: requestedTab });
    if (activeEnvId) params.set('env', activeEnvId);
    return <Navigate to={`${resourceUrl(scope, 'tasks')}?${params}`} replace />;
  }

  if (!pageScope.loading && componentLevel && !component) {
    return <NotFound message="Component not found" backTo={resourceUrl(broaden(scope)!, 'overview')} backLabel="Back to Project" />;
  }

  // Remounts the portal when the deep link changes, so a new one re-seeds the filters.
  const deepLinkKey = `${deepLink.workflowType ?? ''}:${deepLink.workflowId ?? ''}`;

  return (
    <WorkflowPageFrame
      title="Workflow Executions"
      description={
        componentLevel ? (
          <>
            Start, inspect and manage workflow executions of <strong>{component?.displayName ?? scope.component}</strong>.
          </>
        ) : (
          <>
            Start, inspect and manage workflow executions across all integrations in <strong>{project?.name ?? scope.project}</strong>.
          </>
        )
      }
      loading={pageScope.loading}
      environments={environments}
      activeEnvId={activeEnvId}
      onEnvChange={setSelectedEnvId}
      permitted={pageScope.canViewWorkflows}
      noPermissionMessage={componentLevel ? 'You do not have permission to view workflow executions for this integration.' : 'You do not have permission to view workflow executions for this project.'}>
      {dashboard ? (
        <ProjectWorkflowDashboard scope={scope as ProjectScope} environmentId={activeEnvId} integrations={workflowIntegrations} resource="workflows" canViewHumanTasks={canViewHumanTasks} canViewWorkflows={canViewWorkflows} />
      ) : (
        <AdminPortal key={deepLinkKey} targets={targets} environmentId={activeEnvId} taskQueue={taskQueue} initialWorkflowType={deepLink.workflowType} initialWorkflowId={deepLink.workflowId} />
      )}
    </WorkflowPageFrame>
  );
}
