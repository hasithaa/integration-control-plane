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

import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Drawer, FormControlLabel, IconButton, ListingTable, Radio, RadioGroup, Snackbar, Stack, TextField, Typography } from '@wso2/oxygen-ui';
import { Ban, OctagonX, PauseCircle, PlayCircle, RefreshCw, RotateCcw, X } from '@wso2/oxygen-ui-icons-react';
import { useState } from 'react';
import WorkflowFlowTab from './WorkflowFlowTab';
import {
  isPreparing,
  isRefreshing,
  useBulkRetryReviews,
  useResetPoints,
  useResetWorkflow,
  useWorkflowExecutionGraph,
  useWorkflowHistory,
  useWorkflowInfo,
  useWorkflowInstanceGraph,
  useWorkflowLifecycle,
  valueOf,
  type ResetType,
  type WorkflowLifecycleAction,
} from '../../api/workflows';
import { formatTime } from './helpers';
import { RefreshingNote, type WorkflowScope } from './shared';
import Authorized from '../Authorized';
import { Permissions } from '../../constants/permissions';
import { useLayout } from '../../contexts/LayoutContext';

// The drawer fills the main content area only — right-anchored, its left edge lands at the sidebar
// width so the left navigation stays visible. `sidebarWidth` is supplied live so the panel tracks
// the sidebar's collapsed/expanded state.
const drawerPaperSx = (sidebarWidth: number) => ({ '& .MuiDrawer-paper': { width: `calc(100% - ${sidebarWidth}px)`, position: 'fixed', top: 64, height: 'calc(100% - 64px)', borderLeft: '1px solid', borderColor: 'divider' } });
const headerSx = { px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' };
const emptySx = { py: 4, textAlign: 'center', color: 'text.secondary' };

export default function WorkflowDetailDrawer({ scope, workflowId, onClose }: { scope: WorkflowScope; workflowId: string; onClose: () => void }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [terminateOpen, setTerminateOpen] = useState(false);
  // Reset and bulk retry: the module's recovery tools, surfaced where the run they recover is.
  const [resetOpen, setResetOpen] = useState(false);
  const [resetType, setResetType] = useState<ResetType>('last-workflow-task');
  const [resetEventId, setResetEventId] = useState<number | null>(null);
  const [resetReason, setResetReason] = useState('');
  const [retryOpen, setRetryOpen] = useState(false);
  const [retryAction, setRetryAction] = useState<'retry' | 'fail'>('retry');
  const [retryFeedback, setRetryFeedback] = useState('');
  const resetMutation = useResetWorkflow(scope);
  const bulkRetry = useBulkRetryReviews(scope);
  // The points load only while the dialog is open: a history read has a cost, and most drawer
  // visits never reset anything.
  const { data: resetPointsResult } = useResetPoints(scope, workflowId, resetOpen);
  const resetPoints = valueOf(resetPointsResult) ?? [];
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState<{ severity: 'success' | 'error'; message: string } | null>(null);
  const { sidebarWidth } = useLayout();

  const { data: infoResult, isLoading: loadingInfo, error: infoError } = useWorkflowInfo(scope, workflowId);
  // History is loaded eagerly: the Timeline tab derives the start input from it, renders the timeline,
  // and the History tab renders the raw events.
  const { data: historyResult, isLoading: loadingHistory } = useWorkflowHistory(scope, workflowId);
  // Fetched for the Execution Graph tab (1) and also the Timeline tab (0), which uses the graph's
  // authoritative node types to fix categories/icons the history alone can't determine.
  const { data: graphResult, isLoading: loadingGraph } = useWorkflowExecutionGraph(scope, workflowId);
  // The Flow tab (1) draws the workflow's own structure with this run's path on it. It needs the
  // published descriptor, which an integration built by an older runtime won't have — in that case
  // `graph` comes back null and the tab falls back to the node-link view of the history alone.
  const { data: instanceGraphResult, isLoading: loadingInstanceGraph } = useWorkflowInstanceGraph(scope, workflowId);
  const instanceGraph = valueOf(instanceGraphResult);
  // These reads are materialized through the integration, so a freshly opened drawer is still
  // being prepared. `preparing` folds into each pane's own loading state rather than rendering
  // an empty pane, which would be a wrong answer rather than a slow one.
  const info = valueOf(infoResult);
  const history = valueOf(historyResult) ?? [];
  const graph = valueOf(graphResult);
  const preparing = isPreparing(infoResult) || isPreparing(historyResult) || isPreparing(graphResult) || isPreparing(instanceGraphResult);
  const refreshing = isRefreshing(infoResult) || isRefreshing(historyResult) || isRefreshing(graphResult) || isRefreshing(instanceGraphResult);
  const lifecycle = useWorkflowLifecycle(scope);

  const status = (info?.status as string | undefined) ?? '';

  // Lifecycle actions narrowed by status: a running instance can be suspended/cancelled/terminated,
  // a suspended one resumed/cancelled/terminated; closed instances (completed, failed, terminated,
  // canceled, timed out) get no actions. Note: the runtime currently reports suspended instances
  // as RUNNING (suspend is a signal, not a Temporal status), so SUSPENDED only takes effect once
  // the runtime exposes it.
  const normalizedStatus = status.toUpperCase();
  const isRunning = normalizedStatus === 'RUNNING';
  const isSuspended = normalizedStatus === 'SUSPENDED';
  const showActions = isRunning || isSuspended;

  const runAction = (action: WorkflowLifecycleAction, actionReason?: string) => {
    lifecycle.mutate(
      { workflowId, action, reason: actionReason },
      {
        onSuccess: () => setToast({ severity: 'success', message: `Workflow ${action} requested.` }),
        onError: (e) => setToast({ severity: 'error', message: e instanceof Error ? e.message : `Failed to ${action}.` }),
      },
    );
  };

  const historyEventKeys = history.length > 0 ? Object.keys(history[0]).slice(0, 5) : [];

  return (
    <Drawer anchor="right" open variant="persistent" sx={drawerPaperSx(sidebarWidth)} onClose={onClose}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={headerSx}>
        {/* The id and status live in the Execution card below — repeating them here said
            nothing twice. The header names the page. */}
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Execution Details
        </Typography>
        <IconButton size="small" aria-label="close" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </Stack>

      {/* Lifecycle and recovery actions — only for users who can manage workflow executions.
          The bar renders for CLOSED runs too: reset exists precisely for a run that failed, and
          bulk retry for reviews its failures left behind. */}
      {info && (
        <Authorized permissions={[Permissions.WORKFLOW_MANAGE_WORKFLOWS]}>
          <Stack direction="row" gap={1} sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Button size="small" variant="outlined" startIcon={<RotateCcw size={14} />} disabled={resetMutation.isPending} onClick={() => setResetOpen(true)}>
              Reset…
            </Button>
            <Button size="small" variant="outlined" startIcon={<RefreshCw size={14} />} disabled={bulkRetry.isPending} onClick={() => setRetryOpen(true)}>
              Retry Reviews…
            </Button>
            {isRunning && (
              <Button size="small" variant="outlined" startIcon={<PauseCircle size={14} />} disabled={lifecycle.isPending} onClick={() => runAction('suspend')}>
                Suspend
              </Button>
            )}
            {isSuspended && (
              <Button size="small" variant="outlined" startIcon={<PlayCircle size={14} />} disabled={lifecycle.isPending} onClick={() => runAction('resume')}>
                Resume
              </Button>
            )}
            {showActions && (
              <>
                <Button size="small" variant="outlined" color="warning" startIcon={<Ban size={14} />} disabled={lifecycle.isPending} onClick={() => runAction('cancel')}>
                  Cancel
                </Button>
                <Button size="small" variant="outlined" color="error" startIcon={<OctagonX size={14} />} disabled={lifecycle.isPending} onClick={() => setTerminateOpen(true)}>
                  Terminate
                </Button>
              </>
            )}
          </Stack>
        </Authorized>
      )}

      <Box sx={{ px: 2, pt: 1 }}>
        <RefreshingNote show={refreshing} />
        {loadingInfo || loadingHistory || loadingGraph || loadingInstanceGraph || preparing ? (
          <CircularProgress size={24} sx={{ display: 'block', mx: 'auto', py: 4 }} />
        ) : infoError ? (
          <Typography sx={emptySx}>Could not load workflow info.</Typography>
        ) : (
          <WorkflowFlowTab instanceGraph={instanceGraph} executionGraph={graph} events={history as Array<Record<string, unknown>>} info={info} onOpenHistory={() => setHistoryOpen(true)} environmentId={scope.environmentId} />
        )}
      </Box>

      {/* The raw event history: debugging material, an overlay rather than a place in the page. */}
      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          Event history
          <IconButton size="small" aria-label="close event history" onClick={() => setHistoryOpen(false)}>
            <X size={16} />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {history.length === 0 ? (
            <Typography sx={emptySx}>No history events.</Typography>
          ) : (
            <ListingTable>
              <ListingTable.Head>
                <ListingTable.Row>
                  {historyEventKeys.map((k) => (
                    <ListingTable.Cell key={k}>{k}</ListingTable.Cell>
                  ))}
                </ListingTable.Row>
              </ListingTable.Head>
              <ListingTable.Body>
                {history.map((ev, i) => (
                  <ListingTable.Row key={i}>
                    {historyEventKeys.map((k) => (
                      <ListingTable.Cell key={k}>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                          {typeof ev[k] === 'object' ? JSON.stringify(ev[k]) : String(ev[k] ?? '—')}
                        </Typography>
                      </ListingTable.Cell>
                    ))}
                  </ListingTable.Row>
                ))}
              </ListingTable.Body>
            </ListingTable>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={resetOpen} onClose={() => !resetMutation.isPending && setResetOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Reset workflow</DialogTitle>
        <DialogContent>
          <Stack gap={2} sx={{ pt: 0.5 }}>
            <Alert severity="warning">
              Resetting replays the run up to the chosen point and re-executes everything after it as a new run of the same workflow ID — including activities whose side effects already happened, which run again, and human tasks, which may be asked again. This
              cannot be undone.
            </Alert>
            <RadioGroup value={resetType} onChange={(e) => setResetType(e.target.value as ResetType)}>
              <FormControlLabel value="last-workflow-task" control={<Radio size="small" />} label="Before the last step — redo only the most recent work" />
              <FormControlLabel value="first-workflow-task" control={<Radio size="small" />} label="From the beginning — rerun the whole workflow with its original input" />
              <FormControlLabel value="workflow-task-id" control={<Radio size="small" />} label="A specific point in this run's history" />
            </RadioGroup>
            {resetType === 'workflow-task-id' &&
              (isPreparing(resetPointsResult) ? (
                <Stack direction="row" alignItems="center" gap={1} sx={{ color: 'text.secondary' }}>
                  <CircularProgress size={14} />
                  <Typography variant="caption">Reading this run's reset points from its history…</Typography>
                </Stack>
              ) : resetPoints.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  This run has no reset points yet — no workflow task has completed.
                </Typography>
              ) : (
                <RadioGroup value={resetEventId ?? ''} onChange={(e) => setResetEventId(Number(e.target.value))}>
                  {resetPoints.map((point) => (
                    <FormControlLabel
                      key={point.eventId}
                      value={point.eventId}
                      control={<Radio size="small" />}
                      label={
                        <Typography variant="body2">
                          {point.nodeNames.length ? point.nodeNames.join(', ') : `event ${point.eventId}`} · {formatTime(point.timestamp)}
                          {point.isFirstFailure ? ' — just before the first failure' : ''}
                        </Typography>
                      }
                    />
                  ))}
                </RadioGroup>
              ))}
            <TextField label="Reason" fullWidth value={resetReason} onChange={(e) => setResetReason(e.target.value)} helperText="Recorded with the reset in the run's history and audit trail." />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={resetMutation.isPending} onClick={() => setResetOpen(false)}>
            Back
          </Button>
          <Button
            variant="contained"
            color="warning"
            disabled={resetMutation.isPending || (resetType === 'workflow-task-id' && resetEventId === null)}
            onClick={() =>
              resetMutation.mutate(
                { workflowId, resetType, eventId: resetType === 'workflow-task-id' ? (resetEventId ?? undefined) : undefined, reason: resetReason.trim() || undefined },
                {
                  onSuccess: (handle) => {
                    setResetOpen(false);
                    setToast({ severity: 'success', message: `Workflow reset — new run ${handle?.runId ?? 'started'}.` });
                  },
                  onError: (e) => {
                    setResetOpen(false);
                    setToast({ severity: 'error', message: e instanceof Error ? e.message : 'Reset failed.' });
                  },
                },
              )
            }>
            {resetMutation.isPending ? 'Resetting…' : 'Reset Workflow'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={retryOpen} onClose={() => !bulkRetry.isPending && setRetryOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Decide all pending reviews</DialogTitle>
        <DialogContent>
          <Stack gap={2} sx={{ pt: 0.5 }}>
            <Alert severity="info">
              One decision over every pending review of this instance. Retrying reruns each reviewed activity with its original arguments — a bulk decision cannot edit them; failing propagates each failure to the workflow. Per-review outcomes are reported, so
              a partial result is visible as itself.
            </Alert>
            <RadioGroup value={retryAction} onChange={(e) => setRetryAction(e.target.value as 'retry' | 'fail')}>
              <FormControlLabel value="retry" control={<Radio size="small" />} label="Retry — rerun every reviewed activity with its original arguments" />
              <FormControlLabel value="fail" control={<Radio size="small" />} label="Fail — reject them all; each failure travels to the workflow" />
            </RadioGroup>
            {retryAction === 'fail' && <TextField label="Feedback (optional)" fullWidth multiline minRows={2} value={retryFeedback} onChange={(e) => setRetryFeedback(e.target.value)} helperText="Relayed to the workflow as the rejection reason." />}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={bulkRetry.isPending} onClick={() => setRetryOpen(false)}>
            Back
          </Button>
          <Button
            variant="contained"
            color={retryAction === 'fail' ? 'error' : 'primary'}
            disabled={bulkRetry.isPending}
            onClick={() =>
              bulkRetry.mutate(
                { parentWorkflowId: workflowId, action: retryAction, feedback: retryAction === 'fail' ? retryFeedback.trim() || undefined : undefined },
                {
                  onSuccess: (result) => {
                    setRetryOpen(false);
                    setToast({
                      severity: result.failed > 0 ? 'error' : 'success',
                      message: `${result.requested} review(s): ${result.applied} ${retryAction === 'retry' ? 'retried' : 'failed'}, ${result.skipped} skipped${result.failed > 0 ? `, ${result.failed} errored` : ''}.`,
                    });
                  },
                  onError: (e) => {
                    setRetryOpen(false);
                    setToast({ severity: 'error', message: e instanceof Error ? e.message : 'Bulk decision failed.' });
                  },
                },
              )
            }>
            {bulkRetry.isPending ? 'Submitting…' : retryAction === 'retry' ? 'Retry All' : 'Fail All'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={terminateOpen} onClose={() => setTerminateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Terminate Workflow</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Terminate <strong>{workflowId}</strong> immediately? This cannot be undone.
          </DialogContentText>
          <TextField label="Reason (optional)" fullWidth size="small" value={reason} onChange={(e) => setReason(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTerminateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              runAction('terminate', reason);
              setTerminateOpen(false);
              setReason('');
            }}>
            Terminate
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={toast !== null} autoHideDuration={4000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)} sx={{ width: '100%' }}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Drawer>
  );
}
