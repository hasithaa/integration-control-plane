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

import { useComponentByHandler, useComponents, useEnvironments, useProjectByHandler, type GqlEnvironment } from '../../api/queries';
import { useWorkflowTaskQueues, type WorkflowTarget } from '../../api/workflows';
import { Permissions } from '../../constants/permissions';
import { isWorkflowIntegration } from '../../constants/integrationTypes';
import { useAccessControl } from '../../contexts/AccessControlContext';
import { useLoadComponentPermissions, useLoadProjectPermissions } from '../../hooks/usePermissionLoader';
import { hasComponent, type ComponentScope, type ProjectScope } from '../../nav';

/**
 * Everything the two workflow pages (executions, tasks) share: the resolved project/component, the
 * environments, the permission gates, and — the part that must never be duplicated — the targets.
 *
 * A target's `handler` is the Temporal task queue that integration's worker serves, resolved from
 * what each runtime publishes in its heartbeat metadata. It is what narrows a listing to one
 * integration and routes a row back to the integration that owns it. The component's own "handler"
 * (its name) is only a last resort for integrations whose runtime predates the published queue —
 * those cannot be narrowed, which is the pre-queue behaviour, not a new failure.
 */
export interface WorkflowPageScope {
  componentLevel: boolean;
  project: ReturnType<typeof useProjectByHandler>['data'];
  component: ReturnType<typeof useComponentByHandler>['data'];
  projectId: string;
  componentId: string;
  environments: GqlEnvironment[];
  /** The environment everything on the page reads: the selection when it names a real environment,
   * else the first one. Resolved here — not by each page — because the queue lookup below needs it
   * before the page's own resolution runs; a page passing the raw (initially empty) selection would
   * silently never load the queues, unmapping every integration. */
  activeEnvId: string;
  targets: WorkflowTarget[];
  /** Integration scope: that integration's real task queue (undefined until published). Project scope: undefined. */
  taskQueue?: string;
  loading: boolean;
  canViewHumanTasks: boolean;
  canViewWorkflows: boolean;
}

export function useWorkflowPageScope(scope: ComponentScope | ProjectScope, selectedEnvId: string): WorkflowPageScope {
  const componentLevel = hasComponent(scope);
  const { data: project, isLoading: loadingProject } = useProjectByHandler(scope.project);
  const projectId = project?.id ?? '';
  const { data: component, isLoading: loadingComponent } = useComponentByHandler(projectId, componentLevel ? scope.component : undefined);
  const { data: allComponents = [], isLoading: loadingComponents } = useComponents(scope.org, projectId);
  const { data: environments = [], isLoading: loadingEnvs } = useEnvironments(projectId);
  const componentId = component?.id ?? '';
  const activeEnvId = environments.some((e) => e.id === selectedEnvId) ? selectedEnvId : (environments[0]?.id ?? '');

  useLoadComponentPermissions(scope.org, projectId, componentLevel ? componentId : '');
  useLoadProjectPermissions(scope.org, projectId);
  const { hasAnyPermission } = useAccessControl();

  // Base targets, before their queues are known. Project scope puts workflow-typed integrations
  // first so targets[0] — the gateway every read goes through — has a workflow engine. The others
  // are kept: workflow management is per runtime, so a differently-typed integration may still host
  // workflows. Copied before sorting so the cached component list is not mutated.
  const baseTargets: WorkflowTarget[] = componentLevel
    ? component
      ? [{ componentId: component.id, componentName: component.displayName ?? component.name, handler: component.handler }]
      : []
    : [...allComponents].sort((a, b) => Number(isWorkflowIntegration(b.displayType)) - Number(isWorkflowIntegration(a.displayType))).map((c) => ({ componentId: c.id, componentName: c.displayName ?? c.name, handler: c.handler }));

  // The published queues, fetched once through the gateway (the endpoint answers for the whole
  // project). Until they arrive the targets keep the name-fallback, and anything scoped by queue
  // simply spans the namespace for one render — over-showing briefly, never filtering by a queue
  // that does not exist.
  const gatewayComponentId = baseTargets[0]?.componentId ?? '';
  const { data: queues = {} } = useWorkflowTaskQueues({ componentId: gatewayComponentId, environmentId: activeEnvId });
  const targets = baseTargets.map((t) => ({ ...t, handler: queues[t.componentId] ?? t.handler }));

  // Integration scope narrows every listing to this integration's queue. Undefined until the queue
  // is published: filtering by the fallback name would silently return nothing.
  const taskQueue = componentLevel ? queues[componentId] : undefined;

  const permScope = componentLevel ? componentId : undefined;
  const canViewHumanTasks = hasAnyPermission([Permissions.WORKFLOW_VIEW_HUMAN_TASKS, Permissions.WORKFLOW_MANAGE_HUMAN_TASKS], projectId, permScope);
  // Review Activities is gated on the workflow permissions, not the human-task ones: the proxy
  // authorizes /review-activities on that branch, so a Viewer holding only view_human_tasks would
  // otherwise be offered a view that 403s on load.
  const canViewWorkflows = hasAnyPermission([Permissions.WORKFLOW_VIEW_WORKFLOWS, Permissions.WORKFLOW_MANAGE_WORKFLOWS], projectId, permScope);

  return {
    componentLevel,
    project,
    component,
    projectId,
    componentId,
    environments,
    activeEnvId,
    targets,
    taskQueue,
    loading: loadingProject || loadingComponent || loadingEnvs || loadingComponents,
    canViewHumanTasks,
    canViewWorkflows,
  };
}
