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

import { Alert, Box, Button, Chip, CircularProgress, IconButton, ListingTable, MenuItem, Snackbar, Stack, TextField, Tooltip, Typography } from '@wso2/oxygen-ui';
import SearchField from '../SearchField';
import { RefreshCw, UserCheck, Wrench } from '@wso2/oxygen-ui-icons-react';
import { useEffect, useState, type ReactNode } from 'react';
import SchemaFormFields from './SchemaFormFields';
import StructuredValue from './StructuredValue';
import { buildFormResult, displayWorkflowId, formatTime, gatewayScope, jsonPretty, ownerLabel, ownerScope, parseFormSchema, sortByStartTimeDesc, unescapeRoleName, type PortalScope } from './helpers';
import { ActionRow, DetailDrawer, DetailRow, HeaderCell, ListFooter, SectionCard, StatusChip, SubmitError, WorkflowIdLink, type WorkflowScope } from './shared';
import { IntegrationFilter, ReviewActivityDetailDialog, StatusFilter, useTimeRangeFilter, WorkflowNameFilter } from './AdminPortal';
import Authorized from '../Authorized';
import { Permissions } from '../../constants/permissions';
import { distinctWorkflowTypes, useCompleteHumanTask, useFailHumanTask, useHumanTask, useWorkflowDefinitionsAcross, useWorkItemsInfinite, type HumanTask, type WorkflowDefinition, type WorkflowTarget } from '../../api/workflows';

const emptySx = { py: 4, textAlign: 'center', color: 'text.secondary' } as const;

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

// ── The unified work queue ──
//
// A review is a human task with a fixed decision contract, and the person is the same — so both
// kinds share one queue and one filter row. The kinds stay distinct everywhere else: each row
// says what it is (a wrench and its trigger for reviews), and each opens its own drawer.

type WorkKind = 'task' | 'review';

interface WorkItem {
  kind: WorkKind;
  id: string;
  title: string;
  workflowName?: string;
  parentWorkflowId?: string;
  taskQueue?: string;
  status?: string;
  startTime?: string;
  /** Review only: why it exists — PRE_RUN (approval gate) or ON_FAILURE (rerun decision). */
  trigger?: string;
  /** Task only: pending but the caller holds no completing role. */
  readOnly?: boolean;
}

const WORK_TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'task', label: 'Tasks' },
  { value: 'review', label: 'Reviews' },
] as const;
type WorkTypeFilter = (typeof WORK_TYPE_OPTIONS)[number]['value'];

// The union of both kinds' statuses; FAILED is task-only (a rejected review completes — the
// failure travels to the workflow, not into the review's own status).
const WORK_STATUSES = ['All', 'PENDING', 'COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED'];

/** Compact trigger label for list chips. */
const triggerChipLabel = (trigger?: string): string => (trigger === 'ON_FAILURE' ? 'Failure review' : trigger === 'PRE_RUN' ? 'Approval gate' : 'Review');

/** Hosts the unified queue and owns the toast everything under it reports through. */
export default function UserPortal({
  targets,
  environmentId,
  taskQueue,
  canViewTasks,
  canViewReviews,
  initialKind,
  initialTaskId,
  initialReviewId,
}: PortalScope & { canViewTasks: boolean; canViewReviews: boolean; initialKind?: 'reviews'; initialTaskId?: string; initialReviewId?: string }) {
  const scope: PortalScope = { targets, environmentId, taskQueue };
  const [toast, setToast] = useState<Toast>(null);

  return (
    <>
      <WorkQueue scope={scope} onToast={setToast} canViewTasks={canViewTasks} canViewReviews={canViewReviews} initialKind={initialKind} initialTaskId={initialTaskId} initialReviewId={initialReviewId} />

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

function WorkItemTable({ items, onOpen, environmentId, integrationLabel }: { items: WorkItem[]; onOpen: (w: WorkItem) => void; environmentId: string; integrationLabel?: (taskQueue?: string) => string }) {
  return (
    <ListingTable>
      <ListingTable.Head>
        <ListingTable.Row>
          <HeaderCell label="Task" help="The work waiting for a person: a human task (generated form), or a review activity — a fixed decision the workflow feature provides, marked with a wrench." />
          <HeaderCell label="Workflow Name" help="The workflow definition the parent instance executes." />
          {integrationLabel && <HeaderCell label="Integration" help="The integration whose runtime owns this item, resolved from its task queue." />}
          <HeaderCell label="Workflow ID" help="The parent workflow instance waiting on this item — click to open it." />
          <HeaderCell label="Status" help="The item's current state. A rejected review completes — its failure travels to the workflow." />
          <HeaderCell label="Started" help="When the item was created." />
        </ListingTable.Row>
      </ListingTable.Head>
      <ListingTable.Body>
        {items.map((w) => {
          const Icon = w.kind === 'review' ? Wrench : UserCheck;
          return (
            <ListingTable.Row key={`${w.kind}:${w.id}`} onClick={() => onOpen(w)} sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}>
              <ListingTable.Cell>
                <Stack direction="row" alignItems="center" gap={1}>
                  <Tooltip title={w.kind === 'review' ? 'Review activity — a fixed decision the workflow feature provides' : 'Human task'}>
                    <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                      <Icon size={14} />
                    </Box>
                  </Tooltip>
                  <Typography variant="body2">{w.title}</Typography>
                  {w.kind === 'review' && <Chip label={triggerChipLabel(w.trigger)} size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />}
                  {w.readOnly && (
                    <Tooltip title="You do not have a matching role to complete this task">
                      <Chip label="Read-only" size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />
                    </Tooltip>
                  )}
                </Stack>
              </ListingTable.Cell>
              <ListingTable.Cell>
                <Typography variant="body2">{w.workflowName ?? '—'}</Typography>
              </ListingTable.Cell>
              {integrationLabel && (
                <ListingTable.Cell>
                  <Typography variant="body2">{integrationLabel(w.taskQueue)}</Typography>
                </ListingTable.Cell>
              )}
              <ListingTable.Cell>
                <WorkflowIdLink workflowId={w.parentWorkflowId} environmentId={environmentId} />
              </ListingTable.Cell>
              <ListingTable.Cell>
                <StatusChip status={w.status} />
              </ListingTable.Cell>
              <ListingTable.Cell>{formatTime(w.startTime)}</ListingTable.Cell>
            </ListingTable.Row>
          );
        })}
      </ListingTable.Body>
    </ListingTable>
  );
}

function WorkQueue({
  scope,
  onToast,
  canViewTasks,
  canViewReviews,
  initialKind,
  initialTaskId,
  initialReviewId,
}: {
  scope: PortalScope;
  onToast: (t: Toast) => void;
  canViewTasks: boolean;
  canViewReviews: boolean;
  initialKind?: 'reviews';
  initialTaskId?: string;
  initialReviewId?: string;
}) {
  // Each kind opens against the integration that owns it, per the row's own task queue.
  const [openTask, setOpenTask] = useState<{ taskId: string; taskQueue?: string; status?: string } | null>(null);
  const [openReview, setOpenReview] = useState<{ taskId: string; taskQueue?: string } | null>(null);
  // A deep link names an item this list may not hold (a completed one, another page); fetch it
  // directly and open its drawer once it arrives.
  const { data: linkedTask } = useHumanTask(gatewayScope(scope), initialTaskId ?? null);
  useEffect(() => {
    if (linkedTask) setOpenTask({ taskId: linkedTask.taskId, taskQueue: linkedTask.taskQueue, status: linkedTask.status });
  }, [linkedTask]);
  useEffect(() => {
    if (initialReviewId) setOpenReview({ taskId: initialReviewId });
  }, [initialReviewId]);

  const [workType, setWorkType] = useState<WorkTypeFilter>(initialKind === 'reviews' ? 'review' : 'all');
  const [status, setStatus] = useState('PENDING');
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState<WorkflowDefinition | null>(null);
  const [integration, setIntegration] = useState<WorkflowTarget | null>(null);
  const timeFilter = useTimeRangeFilter();

  const multi = scope.targets.length > 1;
  const taskQueue = integration?.handler ?? scope.taskQueue;
  const definitions = useWorkflowDefinitionsAcross(scope.targets, scope.environmentId);

  // One source: the module's unified work-items listing. The proxy narrows the kinds to the
  // caller's permissions, so an unpermitted side simply never appears; the Type filter narrows
  // further by choice. Every filter — including the workflow name — runs server-side, and both
  // kinds ride one token stream.
  const query = useWorkItemsInfinite(gatewayScope(scope), {
    kind: workType === 'task' ? 'HUMAN_TASK' : workType === 'review' ? 'REVIEW_ACTIVITY' : undefined,
    status: status === 'All' ? undefined : status,
    parentWorkflowId: search || undefined,
    parentWorkflowType: selectedType?.workflowType || undefined,
    taskQueue,
    startTimeFrom: timeFilter.bounds.startTimeFrom,
    startTimeTo: timeFilter.bounds.startTimeTo,
    limit: 50,
  });
  const items: WorkItem[] = sortByStartTimeDesc(
    (query.data?.pages ?? [])
      .flatMap((p) => p.items ?? [])
      .map((t) => {
        const kind: WorkKind = t.kind === 'REVIEW_ACTIVITY' ? 'review' : 'task';
        const { workflow, task } = splitQualifiedName(t.taskName);
        return {
          kind,
          id: t.taskId,
          title: t.title || task || t.taskId,
          workflowName: t.parentWorkflowType ?? workflow,
          parentWorkflowId: t.parentWorkflowId,
          taskQueue: t.taskQueue,
          status: t.status,
          startTime: t.startTime,
          trigger: t.trigger,
          readOnly: kind === 'task' && t.status === 'PENDING' && t.canComplete === false,
        };
      }),
  );

  const isLoading = query.isLoading;
  const error = query.error;
  const isFetching = query.isFetching;
  const refetchAll = () => void query.refetch();
  const hasMore = query.hasNextPage;
  const loadMore = () => query.fetchNextPage();
  const hasFilters = status !== 'PENDING' || workType !== (initialKind === 'reviews' ? 'review' : 'all') || !!selectedType || !!search || !!integration || timeFilter.active;

  const openItem = (w: WorkItem) => {
    if (w.kind === 'review') setOpenReview({ taskId: w.id, taskQueue: w.taskQueue });
    else setOpenTask({ taskId: w.id, taskQueue: w.taskQueue, status: w.status });
  };

  return (
    <>
      <Stack direction="row" alignItems="center" gap={1.5} sx={{ mb: 2 }} flexWrap="wrap">
        <SearchField value={search} onChange={setSearch} placeholder="Search by workflow ID" sx={{ width: 320 }} />
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={refetchAll} aria-label="Refresh">
            <RefreshCw size={16} style={{ animation: isFetching ? 'spin 1s linear infinite' : 'none' }} />
          </IconButton>
        </Tooltip>
      </Stack>

      <Stack direction="row" gap={1.5} sx={{ mb: 2 }} flexWrap="wrap" alignItems="center">
        {canViewTasks && canViewReviews && (
          <TextField select size="small" label="Type" value={workType} onChange={(e) => setWorkType(e.target.value as WorkTypeFilter)} sx={{ width: 140 }}>
            {WORK_TYPE_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        )}
        <StatusFilter options={WORK_STATUSES} value={status} onChange={setStatus} />
        <WorkflowNameFilter definitions={distinctWorkflowTypes(definitions.items)} value={selectedType} onChange={setSelectedType} />
        {multi && <IntegrationFilter targets={scope.targets} value={integration} onChange={setIntegration} />}
        {timeFilter.controls}
        {hasFilters && (
          <Button
            size="small"
            onClick={() => {
              setWorkType(initialKind === 'reviews' ? 'review' : 'all');
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
      ) : items.length === 0 ? (
        <Typography sx={emptySx}>{status === 'All' ? 'No tasks.' : `No ${status.toLowerCase()} tasks.`}</Typography>
      ) : (
        <>
          <WorkItemTable items={items} onOpen={openItem} environmentId={scope.environmentId} integrationLabel={multi ? (q) => ownerLabel(scope, q) : undefined} />
          <ListFooter count={items.length} singular="item" plural="items" hasMore={hasMore} loadingMore={query.isFetchingNextPage} onLoadMore={loadMore} />
        </>
      )}

      {openTask && <TaskDetailDialog scope={ownerScope(scope, openTask.taskQueue)} taskId={openTask.taskId} actionable={taskDisplayStatus(openTask.status) === 'PENDING'} onClose={() => setOpenTask(null)} onToast={onToast} />}
      {openReview && <ReviewActivityDetailDialog scope={ownerScope(scope, openReview.taskQueue)} taskId={openReview.taskId} onClose={() => setOpenReview(null)} onToast={onToast} />}
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

  // A small right-aligned button row at the bottom of the active step's card — actions live
  // beside the content they act on, not in a footer a screen-height away.
  const stepButtons = (...buttons: ReactNode[]) => (
    <Stack direction="row" justifyContent="flex-end" gap={1}>
      {buttons}
    </Stack>
  );

  return (
    <DetailDrawer title={task ? taskDisplayName(task) : displayWorkflowId(taskId)} status={taskDisplayStatus(task?.status)} onClose={onClose}>
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
              </SectionCard>
              <SectionCard title="Task operations">
                <ActionRow
                  caption="Mark as failed — a fail operation: the task is recorded as FAILED and the failure is propagated to the workflow, which decides what happens next."
                  button={
                    <Button variant="text" color="warning" size="small" disabled={busy} onClick={() => setMode('fail')}>
                      Mark as failed…
                    </Button>
                  }
                />
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
                    {stepButtons(
                      <Button key="b" disabled={busy} onClick={() => backTo('view')}>
                        Back
                      </Button>,
                      <Button key="r" variant="contained" disabled={busy} onClick={stageComplete}>
                        Review before completion
                      </Button>,
                    )}
                  </>
                ) : (
                  <>
                    <Alert severity="info">The task completes with the result below, and the waiting workflow resumes with it. This cannot be undone.</Alert>
                    <StructuredValue title="Result to submit" raw={jsonPretty(pendingResult) || '{}'} environmentId={scope.environmentId} />
                    {stepButtons(
                      <Button key="b" disabled={busy} onClick={() => backTo('complete')}>
                        Back
                      </Button>,
                      <Button key="c" variant="contained" disabled={busy} onClick={submitComplete}>
                        {complete.isPending ? 'Completing…' : 'Complete Task'}
                      </Button>,
                    )}
                  </>
                )}
              </Stack>
            </SectionCard>
          )}

          {mode === 'fail' && (
            <SectionCard title="Mark task as failed">
              <Stack gap={2}>
                <Alert severity="warning">Failing is a fail operation: the task is recorded as FAILED and the failure is propagated to the workflow — the workflow decides what happens next. This cannot be undone.</Alert>
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
                {stepButtons(
                  <Button key="b" disabled={busy} onClick={() => backTo('view')}>
                    Back
                  </Button>,
                  <Button key="f" variant="contained" color="warning" disabled={busy} onClick={submitFail}>
                    {fail.isPending ? 'Submitting…' : 'Mark as Failed'}
                  </Button>,
                )}
              </Stack>
            </SectionCard>
          )}
        </Stack>
      )}
    </DetailDrawer>
  );
}
