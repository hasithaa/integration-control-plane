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

import { Alert, Box, Button, Chip, CircularProgress, Divider, IconButton, ListingTable, Snackbar, Stack, TextField, Tooltip, Typography } from '@wso2/oxygen-ui';
import SearchField from '../SearchField';
import { RefreshCw } from '@wso2/oxygen-ui-icons-react';
import { useEffect, useState } from 'react';
import SchemaFormFields from './SchemaFormFields';
import StructuredValue from './StructuredValue';
import { buildFormResult, displayWorkflowId, formatTime, gatewayScope, jsonPretty, ownerLabel, ownerScope, parseFormSchema, sortByStartTimeDesc, unescapeRoleName, type PortalScope } from './helpers';
import { ActionRow, DetailDrawer, DetailRow, HeaderCell, ListFooter, SectionCard, StatusChip, SubmitError, WorkflowIdLink, type WorkflowScope } from './shared';
import { IntegrationFilter, ReviewActivities, StatusFilter, useTimeRangeFilter, WorkflowNameFilter } from './AdminPortal';
import Authorized from '../Authorized';
import { Permissions } from '../../constants/permissions';
import { distinctWorkflowTypes, useCompleteHumanTask, useFailHumanTask, useHumanTask, useHumanTasksInfinite, useWorkflowDefinitionsAcross, type HumanTask, type WorkflowDefinition, type WorkflowTarget } from '../../api/workflows';

const emptySx = { py: 4, textAlign: 'center', color: 'text.secondary' } as const;

// Statuses a human task reports. Pending is the default: it is the work waiting on the user, and the
// rest are the history that used to live in its own view.
const HUMAN_TASK_STATUSES = ['All', 'PENDING', 'COMPLETED', 'FAILED', 'TERMINATED'];

/**
 * Maps a runtime human-task status to its display status: a pending task's child workflow
 * reports RUNNING (shown as PENDING). Failed tasks report FAILED directly.
 */
const taskDisplayStatus = (s?: string) => (s === 'RUNNING' ? 'PENDING' : s);

/**
 * Display name for a human task: the title when set, else the task name with its
 * `<workflowType>.` qualifier stripped (runtime reports names as e.g. `placeOrderWorkflow.approveOrder`).
 */
function taskDisplayName(t?: HumanTask): string {
  if (!t) return '';
  if (t.title) return t.title;
  if (t.taskName) {
    const prefix = t.parentWorkflowType ? `${t.parentWorkflowType}.` : '';
    return prefix && t.taskName.startsWith(prefix) ? t.taskName.slice(prefix.length) : t.taskName;
  }
  return t.taskId;
}

type Toast = { severity: 'success' | 'error'; message: string } | null;

/**
 * Hosts the two user-facing workflow views. Which one shows is decided by the page's tabs, so this
 * only dispatches and owns the toast both views report through.
 */
export default function UserPortal({ targets, environmentId, taskQueue, view, initialTaskId, initialReviewId }: PortalScope & { view: 'tasks' | 'reviews'; initialTaskId?: string; initialReviewId?: string }) {
  const scope: PortalScope = { targets, environmentId, taskQueue };
  const [toast, setToast] = useState<Toast>(null);

  return (
    <>
      {view === 'tasks' ? <MyTasks scope={scope} onToast={setToast} initialTaskId={initialTaskId} /> : <ReviewActivities scope={scope} onToast={setToast} initialReviewId={initialReviewId} />}

      <Snackbar open={toast !== null} autoHideDuration={4000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)} sx={{ width: '100%' }}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}

function TaskTable({ tasks, onOpen, environmentId, integrationLabel }: { tasks: HumanTask[]; onOpen: (t: HumanTask) => void; environmentId: string; integrationLabel?: (taskQueue?: string) => string }) {
  return (
    <ListingTable>
      <ListingTable.Head>
        <ListingTable.Row>
          <HeaderCell label="Task" help="The human task waiting for a person — its title, or its name in the workflow." />
          <HeaderCell label="Workflow Name" help="The workflow definition the parent instance executes." />
          {integrationLabel && <HeaderCell label="Integration" help="The integration whose runtime owns this task, resolved from its task queue." />}
          <HeaderCell label="Workflow ID" help="The parent workflow instance waiting on this task — click to open it." />
          <HeaderCell label="Status" help="The task's current state." />
          <HeaderCell label="Started" help="When the task was created." />
        </ListingTable.Row>
      </ListingTable.Head>
      <ListingTable.Body>
        {tasks.map((t) => (
          <ListingTable.Row key={t.taskId} onClick={() => onOpen(t)} sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}>
            <ListingTable.Cell>
              <Stack direction="row" alignItems="center" gap={1}>
                <Typography variant="body2">{taskDisplayName(t)}</Typography>
                {taskDisplayStatus(t.status) === 'PENDING' && t.canComplete === false && (
                  <Tooltip title="You do not have a matching role to complete this task">
                    <Chip label="Read-only" size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />
                  </Tooltip>
                )}
              </Stack>
            </ListingTable.Cell>
            <ListingTable.Cell>
              <Typography variant="body2">{t.parentWorkflowType ?? '—'}</Typography>
            </ListingTable.Cell>
            {integrationLabel && (
              <ListingTable.Cell>
                <Typography variant="body2">{integrationLabel(t.taskQueue)}</Typography>
              </ListingTable.Cell>
            )}
            <ListingTable.Cell>
              <WorkflowIdLink workflowId={t.parentWorkflowId} environmentId={environmentId} />
            </ListingTable.Cell>
            <ListingTable.Cell>
              <StatusChip status={taskDisplayStatus(t.status)} />
            </ListingTable.Cell>
            <ListingTable.Cell>{formatTime(t.startTime)}</ListingTable.Cell>
          </ListingTable.Row>
        ))}
      </ListingTable.Body>
    </ListingTable>
  );
}

function MyTasks({ scope, onToast, initialTaskId }: { scope: PortalScope; onToast: (t: Toast) => void; initialTaskId?: string }) {
  // Opened against the integration that owns the task, per the task's own task queue.
  const [open, setOpen] = useState<HumanTask | null>(null);
  // A deep link names a task this list may not hold (a completed one, another page); fetch it
  // directly and open its dialog once it arrives.
  const { data: linkedTask } = useHumanTask(gatewayScope(scope), initialTaskId ?? null);
  useEffect(() => {
    if (linkedTask) setOpen(linkedTask);
  }, [linkedTask]);
  const [status, setStatus] = useState('PENDING');
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState<WorkflowDefinition | null>(null);
  const [integration, setIntegration] = useState<WorkflowTarget | null>(null);
  const timeFilter = useTimeRangeFilter();

  const multi = scope.targets.length > 1;
  const taskQueue = integration?.handler ?? scope.taskQueue;
  const definitions = useWorkflowDefinitionsAcross(scope.targets, scope.environmentId);
  // Every filter is the runtime's own — parent workflow id, workflow type, queue, time bounds —
  // so paging stays honest: what "Load more" appends is the next page of the same question.
  const { data, isLoading, error, refetch, isFetching, hasNextPage, fetchNextPage, isFetchingNextPage } = useHumanTasksInfinite(gatewayScope(scope), {
    status: status === 'All' ? undefined : status,
    parentWorkflowId: search || undefined,
    parentWorkflowType: selectedType?.workflowType || undefined,
    taskQueue,
    startTimeFrom: timeFilter.bounds.startTimeFrom,
    startTimeTo: timeFilter.bounds.startTimeTo,
    limit: 50,
  });
  const tasks = sortByStartTimeDesc((data?.pages ?? []).flatMap((p) => p.items ?? []));
  const hasFilters = status !== 'PENDING' || !!selectedType || !!search || !!integration || timeFilter.active;

  return (
    <>
      <Stack direction="row" alignItems="center" gap={1.5} sx={{ mb: 2 }} flexWrap="wrap">
        <SearchField value={search} onChange={setSearch} placeholder="Search by workflow ID" sx={{ width: 320 }} />
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => refetch()} aria-label="Refresh">
            <RefreshCw size={16} style={{ animation: isFetching ? 'spin 1s linear infinite' : 'none' }} />
          </IconButton>
        </Tooltip>
      </Stack>

      <Stack direction="row" gap={1.5} sx={{ mb: 2 }} flexWrap="wrap" alignItems="center">
        <StatusFilter options={HUMAN_TASK_STATUSES} value={status} onChange={setStatus} />
        <WorkflowNameFilter definitions={distinctWorkflowTypes(definitions.items)} value={selectedType} onChange={setSelectedType} />
        {multi && <IntegrationFilter targets={scope.targets} value={integration} onChange={setIntegration} />}
        {timeFilter.controls}
        {hasFilters && (
          <Button
            size="small"
            onClick={() => {
              setStatus('PENDING');
              setSelectedType(null);
              setSearch('');
              setIntegration(null);
              timeFilter.reset();
            }}>
            Clear
          </Button>
        )}
      </Stack>

      {isLoading ? (
        <CircularProgress size={24} sx={{ display: 'block', mx: 'auto', py: 4 }} />
      ) : error ? (
        <Typography sx={emptySx}>{error instanceof Error ? error.message : 'Failed to load tasks.'}</Typography>
      ) : tasks.length === 0 ? (
        <Typography sx={emptySx}>{status === 'All' ? 'No tasks.' : `No ${status.toLowerCase()} tasks.`}</Typography>
      ) : (
        <>
          <TaskTable tasks={tasks} onOpen={setOpen} environmentId={scope.environmentId} integrationLabel={multi ? (taskQueue) => ownerLabel(scope, taskQueue) : undefined} />
          <ListFooter count={tasks.length} singular="task" plural="tasks" hasMore={hasNextPage} loadingMore={isFetchingNextPage} onLoadMore={() => fetchNextPage()} />
        </>
      )}

      {open && <TaskDetailDialog scope={ownerScope(scope, open.taskQueue)} taskId={open.taskId} actionable={taskDisplayStatus(open.status) === 'PENDING'} onClose={() => setOpen(null)} onToast={onToast} />}
    </>
  );
}

/**
 * The human-task drawer. Reading and acting are kept apart: the task's own facts (who may act,
 * when it was created, the payload it carries) are read-only sections, and each action states
 * what it does before it can be taken — completing is the task's purpose and leads; failing is a
 * task *operation* with consequences, so it is quieter and warns. Both submit in two steps.
 */
function TaskDetailDialog({ scope, taskId, actionable, onClose, onToast }: { scope: WorkflowScope; taskId: string; actionable?: boolean; onClose: () => void; onToast: (t: Toast) => void }) {
  const { data: task, isLoading, error: taskError } = useHumanTask(scope, taskId);
  const complete = useCompleteHumanTask(scope);
  const fail = useFailHumanTask(scope);
  const [mode, setMode] = useState<'view' | 'complete' | 'confirm-complete' | 'fail'>('view');
  // The escape hatch: a generated form cannot express every value (and a schema bug should not
  // block a completion), so the result is always editable as raw JSON too.
  const [rawMode, setRawMode] = useState(false);
  const [resultText, setResultText] = useState('{}');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [formValues, setFormValues] = useState<Record<string, string | boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  // The result confirmed in step two — built once when entering the confirmation.
  const [pendingResult, setPendingResult] = useState<unknown>(null);

  const busy = complete.isPending || fail.isPending;
  const canComplete = task?.canComplete !== false;
  const eligibleRoles = task?.eligibleRoles ?? (Array.isArray(task?.roles) ? (task.roles as string[]) : undefined) ?? task?.userRoles;
  const formFields = parseFormSchema(task?.formSchema);
  const payloadJson = task?.payload !== undefined && task?.payload !== null ? jsonPretty(task.payload) : null;

  const setFormValue = (name: string, value: string | boolean) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  // Step one: validate and stage the result; step two actually submits it.
  const stageComplete = () => {
    if (formFields && !rawMode) {
      const { result, errors } = buildFormResult(formFields, formValues);
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        return;
      }
      setPendingResult(result);
      setMode('confirm-complete');
      return;
    }
    try {
      setPendingResult(resultText.trim() ? JSON.parse(resultText) : {});
      setMode('confirm-complete');
    } catch {
      setErr('Result must be valid JSON.');
    }
  };

  const submitComplete = () => {
    setSubmitError(null);
    complete.mutate(
      { taskId, result: pendingResult },
      {
        onSuccess: () => {
          onToast({ severity: 'success', message: 'Task completed.' });
          onClose();
        },
        onError: (e) => setSubmitError(e instanceof Error && e.message ? e.message : 'Failed to complete task.'),
      },
    );
  };

  const submitFail = () => {
    if (!reason.trim()) {
      setErr('Reason is required.');
      return;
    }
    setSubmitError(null);
    fail.mutate(
      { taskId, reason: reason.trim() },
      {
        onSuccess: () => {
          onToast({ severity: 'success', message: 'Task marked as failed.' });
          onClose();
        },
        onError: (e) => setSubmitError(e instanceof Error && e.message ? e.message : 'Failed to fail the task.'),
      },
    );
  };

  // Returns one step back, keeping entered values but clearing validation errors.
  const backTo = (m: 'view' | 'complete') => {
    setMode(m);
    setErr('');
    setFieldErrors({});
    setSubmitError(null);
  };

  const actions = (
    <>
      <Button onClick={onClose}>Close</Button>
      <Box sx={{ flex: 1 }} />
      {/* Acting on human tasks requires the workflow manage-human-tasks permission. */}
      <Authorized permissions={[Permissions.WORKFLOW_MANAGE_HUMAN_TASKS]}>
        {mode === 'complete' && (
          <>
            <Button disabled={busy} onClick={() => backTo('view')}>
              Back
            </Button>
            <Button variant="contained" disabled={busy} onClick={stageComplete}>
              Review &amp; Complete
            </Button>
          </>
        )}
        {mode === 'confirm-complete' && (
          <>
            <Button disabled={busy} onClick={() => backTo('complete')}>
              Back
            </Button>
            <Button variant="contained" disabled={busy} onClick={submitComplete}>
              {complete.isPending ? 'Completing…' : 'Complete Task'}
            </Button>
          </>
        )}
        {mode === 'fail' && (
          <>
            <Button disabled={busy} onClick={() => backTo('view')}>
              Back
            </Button>
            <Button variant="contained" color="warning" disabled={busy} onClick={submitFail}>
              {fail.isPending ? 'Submitting…' : 'Mark as Failed'}
            </Button>
          </>
        )}
      </Authorized>
    </>
  );

  return (
    <DetailDrawer title={task ? taskDisplayName(task) : displayWorkflowId(taskId)} status={taskDisplayStatus(task?.status)} onClose={onClose} actions={actions}>
      {isLoading ? (
        <CircularProgress size={24} sx={{ display: 'block', mx: 'auto', py: 4 }} />
      ) : taskError || !task ? (
        <Typography sx={emptySx}>{taskError instanceof Error ? taskError.message : 'Failed to load task details.'}</Typography>
      ) : (
        <Stack gap={2}>
          <SubmitError message={submitError} onClear={() => setSubmitError(null)} />
          {task?.description && (
            <SectionCard title="Description">
              <Typography variant="body2" color="text.secondary">
                {task.description}
              </Typography>
            </SectionCard>
          )}

          <SectionCard title="Task">
            <Stack gap={1.25}>
              <DetailRow label="Task Name">{taskDisplayName(task)}</DetailRow>
              <DetailRow label="Workflow Name">{task.parentWorkflowType ?? '—'}</DetailRow>
              <DetailRow label="Parent Workflow">
                <WorkflowIdLink workflowId={task.parentWorkflowId} environmentId={scope.environmentId} onNavigate={onClose} />
              </DetailRow>
              <DetailRow label="Created">{formatTime(task?.startTime)}</DetailRow>
              <DetailRow label="Eligible Roles">
                {eligibleRoles?.length ? (
                  <Stack direction="row" gap={0.5} flexWrap="wrap">
                    {eligibleRoles.map((role) => (
                      <Chip key={role} label={unescapeRoleName(role)} size="small" variant="outlined" />
                    ))}
                  </Stack>
                ) : (
                  '—'
                )}
              </DetailRow>
            </Stack>
          </SectionCard>

          {/* What the workflow handed this task — context to decide with, never something to edit. */}
          {payloadJson && <StructuredValue title="Task payload (read-only)" raw={payloadJson} environmentId={scope.environmentId} />}

          {actionable && mode === 'view' && (
            <Authorized permissions={[Permissions.WORKFLOW_MANAGE_HUMAN_TASKS]}>
              <SectionCard title="Actions">
                <Stack gap={2}>
                  <ActionRow
                    caption="Complete the task: submit a result, and the waiting workflow resumes with it."
                    button={
                      <Tooltip title={canComplete ? '' : 'You do not have a matching role to complete this task'}>
                        <span>
                          <Button variant="contained" disabled={busy || !canComplete} onClick={() => setMode('complete')}>
                            Complete…
                          </Button>
                        </span>
                      </Tooltip>
                    }
                  />
                  <Divider />
                  <ActionRow
                    caption="Task operation — mark the task as FAILED. The failure is surfaced to the workflow, which decides what happens next."
                    button={
                      <Button variant="text" color="warning" size="small" disabled={busy} onClick={() => setMode('fail')}>
                        Mark as failed…
                      </Button>
                    }
                  />
                </Stack>
              </SectionCard>
            </Authorized>
          )}

          {(mode === 'complete' || mode === 'confirm-complete') && (
            <SectionCard title={mode === 'complete' ? 'Result' : 'Confirm completion'}>
              <Stack gap={2}>
                {mode === 'complete' ? (
                  <>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
                      <Typography variant="body2" color="text.secondary">
                        The result the workflow resumes with.
                      </Typography>
                      {formFields && (
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => {
                            // Entering raw mode carries the form's current state along; a raw edit
                            // can express what the form cannot, so it never converts back.
                            if (!rawMode) {
                              const { result } = buildFormResult(formFields, formValues);
                              setResultText(jsonPretty(result) || '{}');
                            }
                            setRawMode((v) => !v);
                            setErr('');
                          }}>
                          {rawMode ? 'Back to form' : 'Edit as JSON'}
                        </Button>
                      )}
                    </Stack>
                    {formFields && !rawMode ? (
                      <SchemaFormFields fields={formFields} values={formValues} errors={fieldErrors} onChange={setFormValue} />
                    ) : (
                      <TextField
                        label="Result (JSON)"
                        fullWidth
                        multiline
                        minRows={5}
                        value={resultText}
                        onChange={(e) => {
                          setResultText(e.target.value);
                          setErr('');
                        }}
                        error={!!err}
                        helperText={err || (formFields ? 'Raw mode: submitted exactly as typed — the form is bypassed.' : 'This task declares no result schema; the JSON is submitted as the result.')}
                        slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <Alert severity="info">The task completes with the result below, and the waiting workflow resumes with it. This cannot be undone.</Alert>
                    <StructuredValue title="Result to submit" raw={jsonPretty(pendingResult) || '{}'} environmentId={scope.environmentId} />
                  </>
                )}
              </Stack>
            </SectionCard>
          )}

          {mode === 'fail' && (
            <SectionCard title="Mark task as failed">
              <Stack gap={2}>
                <Alert severity="warning">The task is recorded as FAILED and the failure is surfaced to the workflow — the workflow decides what happens next. This cannot be undone.</Alert>
                <TextField
                  label="Reason"
                  fullWidth
                  required
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setErr('');
                  }}
                  error={!!err}
                  helperText={err || 'Relayed to the workflow as the failure reason.'}
                />
              </Stack>
            </SectionCard>
          )}
        </Stack>
      )}
    </DetailDrawer>
  );
}
