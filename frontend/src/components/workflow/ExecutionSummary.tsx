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

import { alpha, Box, IconButton, Stack, Tooltip, Typography } from '@wso2/oxygen-ui';
import { Copy } from '@wso2/oxygen-ui-icons-react';
import type { ReactElement, ReactNode } from 'react';
import type { WorkflowInstance } from '../../api/workflows';

import { displayWorkflowId, formatDuration, formatTime, jsonPretty } from './helpers';
import { DebugInfoIcon, StatusChip } from './shared';

/**
 * What happened to this run, extracted: the raw instances.get payload is a debugging document —
 * per-activity invocation records, nulls for everything a closed run no longer carries — and
 * showing it verbatim made the reader do the extraction themselves. The per-activity truth lives
 * in the timeline below and the Flow tab's step details; this card keeps only what describes the
 * run as a whole. The raw payload stays one copy-click away.
 */
export default function ExecutionSummary({
  info,
  fallbackStartMs,
  fallbackEndMs,
  onOpenHistory,
}: {
  info: WorkflowInstance;
  /** From the run's history — the instances payload itself carries no times. */
  fallbackStartMs?: number | null;
  fallbackEndMs?: number | null;
  /** Opens the raw event history — debugging material, so it lives behind this rather than a tab. */
  onOpenHistory?: () => void;
}): ReactElement {
  const status = (info.status ?? '').toUpperCase();
  const closed = !['RUNNING', 'SUSPENDED', ''].includes(status);
  const startMs = info.startTime ? Date.parse(info.startTime) : (fallbackStartMs ?? NaN);
  const closeMs = info.closeTime ? Date.parse(info.closeTime) : closed ? (fallbackEndMs ?? NaN) : NaN;
  const durationMs = Number.isFinite(startMs) && Number.isFinite(closeMs) ? closeMs - startMs : null;
  const errorMessage = typeof info['errorMessage'] === 'string' ? (info['errorMessage'] as string) : null;

  const row = (label: string, value: ReactNode): ReactNode =>
    value == null || value === '' ? null : (
      <Stack key={label} direction="row" gap={1} alignItems="baseline" sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', width: 88, flexShrink: 0 }}>
          {label}
        </Typography>
        <Typography variant="body2" component="div" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {value}
        </Typography>
      </Stack>
    );

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" gap={1}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Execution
          </Typography>
          {status && <StatusChip status={status} />}
          {durationMs != null && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {formatDuration(durationMs)}
            </Typography>
          )}
        </Stack>
        <Stack direction="row" alignItems="center" gap={0.25}>
          {onOpenHistory && (
            <Tooltip title="Debug information: the raw event history">
              <IconButton size="small" aria-label="open debug information" onClick={onOpenHistory}>
                <DebugInfoIcon size={14} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Copy the raw execution info">
            <IconButton size="small" aria-label="copy raw execution info" onClick={() => navigator.clipboard.writeText(jsonPretty(info))}>
              <Copy size={14} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      <Stack gap={0.75} sx={{ px: 1.5, py: 1.25 }}>
        {row(
          'Instance ID',
          info.workflowId ? (
            <Stack direction="row" alignItems="center" gap={0.5} sx={{ minWidth: 0 }}>
              <Box component="span" title={info.workflowId} sx={{ fontFamily: 'monospace', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayWorkflowId(info.workflowId)}
              </Box>
              <Tooltip title="Copy instance ID">
                <IconButton size="small" aria-label="copy instance id" onClick={() => navigator.clipboard.writeText(info.workflowId)} sx={{ p: 0.25 }}>
                  <Copy size={12} />
                </IconButton>
              </Tooltip>
            </Stack>
          ) : null,
        )}
        {row('Workflow name', info.workflowType)}
        {row('Started', Number.isFinite(startMs) ? formatTime(new Date(startMs).toISOString()) : null)}
        {row('Closed', Number.isFinite(closeMs) ? formatTime(new Date(closeMs).toISOString()) : null)}
        {row('Task queue', info.taskQueue)}
        {errorMessage && (
          <Box sx={{ px: 1.25, py: 0.75, borderRadius: 1, border: '1px solid', borderColor: 'error.main', color: 'error.main', bgcolor: (t) => alpha(t.palette.error.main, 0.08) }}>
            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
              {errorMessage}
            </Typography>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
