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

import { Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, ListingTable, MenuItem, Snackbar, Stack, TextField, Tooltip, Typography } from '@wso2/oxygen-ui';
import SearchField from '../SearchField';
import { RefreshCw, UserCheck, Wrench } from '@wso2/oxygen-ui-icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import SchemaFormFields from './SchemaFormFields';
import StructuredValue from './StructuredValue';
import { buildFormResult, displayWorkflowId, formatTime, gatewayScope, jsonPretty, ownerLabel, ownerScope, parseFormSchema, sortByStartTimeDesc, splitQualifiedName, unescapeRoleName, type PortalScope } from './helpers';
import { ActionCard, DetailDrawer, DetailRow, HeaderCell, HeaderMenu, IdText, ListFooter, NotProvided, RefreshingNote, SectionCard, StatusChip, SubmitError, WorkflowIdLink, type WorkflowScope } from './shared';
import { IntegrationFilter, ReviewActivityDetailDialog, StatusFilter, useTimeRangeFilter, WorkflowNameFilter } from './AdminPortal';
import Authorized from '../Authorized';
import { Permissions } from '../../constants/permissions';
import {
  bulkRetryReviewsRequest,
  distinctWorkflowTypes,
  fetchedAtOf,
  invalidateWorkflowQueries,
  isPreparing,
  isRefreshing,
  useCompleteHumanTask,
  useFailHumanTask,
  useHumanTask,
  useWorkflowDefinitionsAcross,
  useWorkItemsInfinite,
  valueOf,
  type HumanTask,
  type WorkflowDefinition,
  type WorkflowTarget,
} from '../../api/workflows';

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
const triggerChipLabel = (trigger?: string): string => (trigger === 'ON_FAILURE' ? 'Review failure' : trigger === 'PRE_RUN' ? 'Approval gate' : 'Review');

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

interface WorkItemSelection {
  selectable: (w: WorkItem) => boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  allSelected: boolean;
}

function WorkItemTable({ items, onOpen, environmentId, integrationLabel, selection }: { items: WorkItem[]; onOpen: (w: WorkItem) => void; environmentId: string; integrationLabel?: (taskQueue?: string) => string; selection?: WorkItemSelection }) {
  return (
    <ListingTable>
      <ListingTable.Head>
        <ListingTable.Row>
          {selection && (
            <ListingTable.Cell sx={{ width: 40, px: 1 }}>
              {/* Selects the selectable — pending reviews. Tasks are completed one at a time
                  through their own forms, so they take no checkbox rather than a disabled one. */}
              <Checkbox size="small" checked={selection.allSelected} indeterminate={!selection.allSelected && selection.selected.size > 0} onChange={selection.onToggleAll} inputProps={{ 'aria-label': 'select all pending reviews' }} />
            </ListingTable.Cell>
          )}
          <HeaderCell label="Task" help="The work waiting for a person: a human task (generated form), or a review activity — a fixed decision the workflow feature provides, marked with a wrench." />
          <HeaderCell label="Workflow Name" help="The workflow definition the parent instance executes." />
          {integrationLabel && <HeaderCell label="Integration" help="The integration whose runtime owns this item, resolved from its task queue." />}
          <HeaderCell label="Task ID" help="The work item's own identifier — what the management API and audit records name it by." />
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
              {selection && (
                <ListingTable.Cell sx={{ width: 40, px: 1 }} onClick={(e) => e.stopPropagation()}>
                  {selection.selectable(w) && <Checkbox size="small" checked={selection.selected.has(w.id)} onChange={() => selection.onToggle(w.id)} inputProps={{ 'aria-label': `select ${w.title}` }} />}
                </ListingTable.Cell>
              )}
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
                <IdText id={w.id} muted />
              </ListingTable.Cell>
              <ListingTable.Cell>
                <WorkflowIdLink workflowId={w.parentWorkflowId} environmentId={environmentId} truncate copy />
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
  const { data: linkedTaskResult } = useHumanTask(gatewayScope(scope), initialTaskId ?? null);
  const linkedTask = valueOf(linkedTaskResult);
  useEffect(() => {
    if (linkedTask) setOpenTask({ taskId: linkedTask.taskId, taskQueue: linkedTask.taskQueue, status: linkedTask.status });
  }, [linkedTask]);
  useEffect(() => {
    if (initialReviewId) setOpenReview({ taskId: initialReviewId });
  }, [initialReviewId]);

  const [workType, setWorkType] = useState<WorkTypeFilter>(initialKind === 'reviews' ? 'review' : 'all');
  // Bulk retry lives here, on a selection — retrying several failed reviews in one go is the
  // actual use, since workflows do not run reviews in parallel and a per-instance bulk always
  // found exactly one. Only pending reviews are selectable.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState<'retry' | 'fail'>('retry');
  const [bulkFeedback, setBulkFeedback] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const qc = useQueryClient();
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
  // Pages are Fetchable now: only ready ones contribute rows, a page being prepared is
  // announced, and a stale one keeps the rows visible while saying fresher ones are coming.
  const queuePreparing = (query.data?.pages ?? []).some((p) => isPreparing(p));
  const queueRefreshing = (query.data?.pages ?? []).some((p) => isRefreshing(p));
  const queueUpdatedAt = (query.data?.pages ?? []).map((p) => fetchedAtOf(p)).filter((ts): ts is number => !!ts)[0];
  const items: WorkItem[] = sortByStartTimeDesc(
    (query.data?.pages ?? [])
      .map((p) => valueOf(p))
      .filter((p) => p !== undefined)
      .flatMap((p) => p?.items ?? [])
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

  const selectable = items.filter((w) => w.kind === 'review' && taskDisplayStatus(w.status) === 'PENDING');
  // Pruned against what is on screen, so a row that got decided (or scrolled out by a filter)
  // does not linger invisibly in the selection and get acted on blind.
  const selected = new Set(selectedIds.filter((id) => selectable.some((w) => w.id === id)));
  const toggleSelected = (id: string) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAll = () => setSelectedIds(selected.size === selectable.length ? [] : selectable.map((w) => w.id));

  const submitBulk = async () => {
    setBulkBusy(true);
    // One request per owning integration: a selection can span task queues, and each batch must
    // reach the runtime that owns its reviews. The outcomes are summed, not blurred — a partial
    // success reports its arithmetic.
    const chosen = selectable.filter((w) => selected.has(w.id));
    const byQueue = new Map<string | undefined, string[]>();
    for (const w of chosen) byQueue.set(w.taskQueue, [...(byQueue.get(w.taskQueue) ?? []), w.id]);
    let applied = 0;
    let skipped = 0;
    let failed = 0;
    let errored: string | null = null;
    for (const [queue, ids] of byQueue) {
      try {
        const result = await bulkRetryReviewsRequest(ownerScope(scope, queue), { taskIds: ids, action: bulkAction, feedback: bulkAction === 'fail' ? bulkFeedback.trim() || undefined : undefined });
        applied += result.applied;
        skipped += result.skipped;
        failed += result.failed;
      } catch (e) {
        errored = e instanceof Error ? e.message : 'Bulk decision failed.';
      }
    }
    setBulkBusy(false);
    setBulkOpen(false);
    setSelectedIds([]);
    invalidateWorkflowQueries(qc, scope.environmentId);
    onToast(
      errored
        ? { severity: 'error', message: errored }
        : {
            severity: failed > 0 ? 'error' : 'success',
            message: `${chosen.length} review(s): ${applied} ${bulkAction === 'retry' ? 'retried' : 'failed'}, ${skipped} skipped${failed > 0 ? `, ${failed} errored` : ''}.`,
          },
    );
  };

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

      <RefreshingNote show={queueRefreshing} fetchedAt={queueUpdatedAt} />
      {isLoading ? (
        <CircularProgress size={24} sx={{ display: 'block', mx: 'auto', py: 4 }} />
      ) : error ? (
        <Typography sx={emptySx}>{error instanceof Error ? error.message : 'Failed to load tasks.'}</Typography>
      ) : queuePreparing && items.length === 0 ? (
        // Not the same statement as "no tasks": the integration has not answered this view yet
        // and the query is already coming back for it.
        <Typography sx={emptySx}>Fetching tasks from the integration…</Typography>
      ) : items.length === 0 ? (
        <Typography sx={emptySx}>{status === 'All' ? 'No tasks.' : `No ${status.toLowerCase()} tasks.`}</Typography>
      ) : (
        <>
          {selected.size > 0 && (
            <Stack direction="row" alignItems="center" gap={1.5} sx={{ px: 1.5, py: 1, mb: 1, border: '1px solid', borderColor: 'primary.main', borderRadius: 1, bgcolor: 'action.selected' }}>
              <Typography variant="body2" sx={{ flex: 1 }}>
                {selected.size} review{selected.size === 1 ? '' : 's'} selected
              </Typography>
              <Button
                size="small"
                variant="contained"
                disabled={bulkBusy}
                onClick={() => {
                  setBulkAction('retry');
                  setBulkOpen(true);
                }}>
                Retry Selected
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                disabled={bulkBusy}
                onClick={() => {
                  setBulkAction('fail');
                  setBulkOpen(true);
                }}>
                Fail Selected
              </Button>
              <Button size="small" variant="text" disabled={bulkBusy} onClick={() => setSelectedIds([])}>
                Clear
              </Button>
            </Stack>
          )}
          <WorkItemTable
            items={items}
            onOpen={openItem}
            environmentId={scope.environmentId}
            integrationLabel={multi ? (q) => ownerLabel(scope, q) : undefined}
            selection={{ selectable: (w) => w.kind === 'review' && taskDisplayStatus(w.status) === 'PENDING', selected, onToggle: toggleSelected, onToggleAll: toggleAll, allSelected: selectable.length > 0 && selected.size === selectable.length }}
          />
          <ListFooter count={items.length} singular="item" plural="items" hasMore={hasMore} loadingMore={query.isFetchingNextPage} onLoadMore={loadMore} />
        </>
      )}

      <Dialog open={bulkOpen} onClose={() => !bulkBusy && setBulkOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{bulkAction === 'retry' ? 'Retry selected reviews' : 'Fail selected reviews'}</DialogTitle>
        <DialogContent>
          <Stack gap={2} sx={{ pt: 0.5 }}>
            <Alert severity={bulkAction === 'retry' ? 'info' : 'warning'}>
              {bulkAction === 'retry'
                ? `Reruns the reviewed activity of each selected review with its original arguments — a bulk decision cannot edit them. ${selected.size} review${selected.size === 1 ? '' : 's'} will be decided; per-review outcomes are reported.`
                : `Rejects every selected review; each failure is propagated to its workflow, which decides what happens next. ${selected.size} review${selected.size === 1 ? '' : 's'} will be decided. This cannot be undone.`}
            </Alert>
            {bulkAction === 'fail' && <TextField label="Feedback (optional)" fullWidth multiline minRows={2} value={bulkFeedback} onChange={(e) => setBulkFeedback(e.target.value)} helperText="Relayed to each workflow as the rejection reason." />}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={bulkBusy} onClick={() => setBulkOpen(false)}>
            Back
          </Button>
          <Button variant="contained" color={bulkAction === 'fail' ? 'error' : 'primary'} disabled={bulkBusy} onClick={() => void submitBulk()}>
            {bulkBusy ? 'Submitting…' : bulkAction === 'retry' ? `Retry ${selected.size}` : `Fail ${selected.size}`}
          </Button>
        </DialogActions>
      </Dialog>

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
  const [pausePolling, setPausePolling] = useState(false);
  const { data: taskResult, isLoading, error: taskError } = useHumanTask(scope, taskId, pausePolling);
  const task = valueOf(taskResult);
  // A dialog whose detail is still being prepared shows its spinner rather than a form with
  // every field blank.
  const waiting = isLoading || isPreparing(taskResult);
  const refreshing = isRefreshing(taskResult);
  const complete = useCompleteHumanTask(scope);
  const fail = useFailHumanTask(scope);
  const [mode, setMode] = useState<'view' | 'complete'>('view');
  // Confirmation and the fail operation are modal overlays: the decision happens in front of the
  // task, not on a screen the context has scrolled away from.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  // Editing pauses the detail's own polling; the confirm and fail overlays pause it too, so the
  // world does not shift behind a decision mid-flight. Mirrored into state because the hook call
  // sits above these declarations.
  const editing = mode === 'complete' || confirmOpen || failOpen;
  if (editing !== pausePolling) setPausePolling(editing);
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
      setConfirmOpen(true);
      return;
    }
    try {
      setPendingResult(resultText.trim() ? JSON.parse(resultText) : {});
      setConfirmOpen(true);
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
        onError: (e) => {
          setConfirmOpen(false);
          setSubmitError(e instanceof Error && e.message ? e.message : 'Failed to complete task.');
        },
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
        onError: (e) => {
          setFailOpen(false);
          setSubmitError(e instanceof Error && e.message ? e.message : 'Failed to fail the task.');
        },
      },
    );
  };

  // Deselecting the action keeps entered values but clears validation state, so a second look
  // at the context does not cost the half-filled form.
  const closeComplete = () => {
    setMode('view');
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
    <DetailDrawer
      title={task ? taskDisplayName(task) : displayWorkflowId(taskId)}
      status={taskDisplayStatus(task?.status)}
      onClose={onClose}
      menu={
        actionable && task ? (
          <Authorized permissions={[Permissions.WORKFLOW_MANAGE_HUMAN_TASKS]}>
            <HeaderMenu items={[{ label: 'Mark as failed…', color: 'warning', disabled: busy, onClick: () => setFailOpen(true) }]} />
          </Authorized>
        ) : undefined
      }>
      {waiting ? (
        <CircularProgress size={24} sx={{ display: 'block', mx: 'auto', py: 4 }} />
      ) : taskError || !task ? (
        <Typography sx={emptySx}>{taskError instanceof Error ? taskError.message : 'Failed to load task details.'}</Typography>
      ) : (
        <Stack gap={2}>
          <SubmitError message={submitError} onClear={() => setSubmitError(null)} />
          <RefreshingNote show={refreshing} />
          {task?.description && (
            <SectionCard title="Description">
              <Typography variant="body2" color="text.secondary">
                {task.description}
              </Typography>
            </SectionCard>
          )}

          <SectionCard title="Task" collapsible>
            <Stack gap={1.25}>
              <DetailRow label="Task Name">{taskDisplayName(task)}</DetailRow>
              <DetailRow label="Workflow Name">{task.parentWorkflowType ?? <NotProvided />}</DetailRow>
              <DetailRow label="Parent Workflow">
                <WorkflowIdLink workflowId={task.parentWorkflowId} environmentId={scope.environmentId} onNavigate={onClose} truncate copy />
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
                  <NotProvided />
                )}
              </DetailRow>
            </Stack>
          </SectionCard>

          {/* What the workflow handed this task — context to decide with, never something to edit. */}
          {payloadJson && <StructuredValue title="Task payload (read-only)" raw={payloadJson} environmentId={scope.environmentId} collapsible />}

          {/* The decision, once there is one: who completed or rejected the task, when, and the
              result the workflow resumed with. Present on the execution but previously shown
              nowhere here — a completed task read as if nothing had been decided. Blank for
              tasks decided before the runtime recorded the completer. */}
          {(task.completedBy || task.completedAt || (task.result !== undefined && task.result !== null)) && (
            <SectionCard title="Decision">
              <Stack gap={1.25}>
                <DetailRow label="Completed By">{task.completedBy ? <IdText id={task.completedBy} /> : <NotProvided />}</DetailRow>
                <DetailRow label="Completed At">{task.completedAt ? formatTime(task.completedAt) : <NotProvided />}</DetailRow>
              </Stack>
            </SectionCard>
          )}
          {task.result !== undefined && task.result !== null && <StructuredValue title="Result submitted" raw={jsonPretty(task.result) || 'null'} environmentId={scope.environmentId} collapsible />}

          {actionable && (
            <Authorized permissions={[Permissions.WORKFLOW_MANAGE_HUMAN_TASKS]}>
              <SectionCard title="Actions">
                <Stack gap={2}>
                  {/* Cards, so the options read side by side before any is chosen. A task offers
                      one primary action today; the grid is what keeps a second one scannable
                      rather than stacked when it arrives. */}
                  <Stack direction="row" flexWrap="wrap" gap={1.5}>
                    <ActionCard
                      title="Complete task"
                      subtitle="Submit a result; the waiting workflow resumes with it."
                      selected={mode === 'complete'}
                      disabled={busy || !canComplete}
                      disabledReason={canComplete ? undefined : 'You do not have a matching role to complete this task'}
                      onClick={() => (mode === 'complete' ? closeComplete() : setMode('complete'))}
                    />
                  </Stack>

                  {/* The selected action's inputs, revealed in place — the context above stays
                      where it was read. */}
                  {mode === 'complete' && (
                    <Stack gap={2} sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 2 }}>
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
                        <Button key="b" disabled={busy} onClick={closeComplete}>
                          Cancel
                        </Button>,
                        <Button key="r" variant="contained" disabled={busy} onClick={stageComplete}>
                          Review before completion
                        </Button>,
                      )}
                    </Stack>
                  )}
                </Stack>
              </SectionCard>
            </Authorized>
          )}

          {/* Confirmation overlays the task instead of replacing it: the payload and the metadata
              stay on screen behind the decision. */}
          <Dialog open={confirmOpen} onClose={() => !busy && setConfirmOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Confirm completion</DialogTitle>
            <DialogContent>
              <Stack gap={2} sx={{ pt: 0.5 }}>
                <Alert severity="info">The task completes with the result below, and the waiting workflow resumes with it. This cannot be undone.</Alert>
                <StructuredValue title="Result to submit" raw={jsonPretty(pendingResult) || '{}'} environmentId={scope.environmentId} />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button disabled={busy} onClick={() => setConfirmOpen(false)}>
                Back
              </Button>
              <Button variant="contained" disabled={busy} onClick={submitComplete}>
                {complete.isPending ? 'Completing…' : 'Complete Task'}
              </Button>
            </DialogActions>
          </Dialog>

          <Dialog open={failOpen} onClose={() => !busy && setFailOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Mark task as failed</DialogTitle>
            <DialogContent>
              <Stack gap={2} sx={{ pt: 0.5 }}>
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
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button disabled={busy} onClick={() => setFailOpen(false)}>
                Back
              </Button>
              <Button variant="contained" color="warning" disabled={busy} onClick={submitFail}>
                {fail.isPending ? 'Submitting…' : 'Mark as Failed'}
              </Button>
            </DialogActions>
          </Dialog>
        </Stack>
      )}
    </DetailDrawer>
  );
}
