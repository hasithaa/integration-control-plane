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

import { alpha, Box, IconButton, Stack, Typography } from '@wso2/oxygen-ui';
import { Clock, X } from '@wso2/oxygen-ui-icons-react';
import type { ExecutionGraphNode } from '../../api/workflows';
import StructuredValue from './StructuredValue';
import { formatDuration, humanizeKey, splitQualifiedName, type NodeExecutionDetail } from './helpers';
import { StatusChip } from './shared';
import { typeLabel } from './graphVisuals';

/** Side panel showing a selected node's execution time, input and result, mapped from the history. */
export default function NodeDetailPanel({ node, detail, hasHistory, onClose, fullWidth = false, environmentId }: { node: ExecutionGraphNode; detail: NodeExecutionDetail; hasHistory: boolean; onClose: () => void; fullWidth?: boolean; environmentId?: string }) {
  const { task } = splitQualifiedName(node.label);

  return (
    <Box sx={{ width: fullWidth ? '100%' : { xs: '100%', md: '45%' }, flexShrink: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', alignSelf: 'stretch' }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1} sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={node.label}>
            {task ?? node.label}
          </Typography>
          <Stack direction="row" alignItems="center" gap={1} sx={{ mt: 0.5 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {typeLabel(node.type)}
            </Typography>
            {detail.status && <StatusChip status={detail.status} />}
            {detail.durationMs != null && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Clock size={13} />
                {formatDuration(detail.durationMs)}
              </Typography>
            )}
          </Stack>
        </Stack>
        <IconButton size="small" aria-label="close node details" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </Stack>

      <Stack gap={2} sx={{ p: 2 }}>
        {detail.callConfig && Object.keys(detail.callConfig).length > 0 && (
          <Stack direction="row" gap={1} sx={{ flexWrap: 'wrap' }}>
            {Object.entries(detail.callConfig).map(([key, value]) => {
              const label = key === 'stepId' ? 'Step' : key === 'retryOnError' ? 'Retries on error' : humanizeKey(key);
              const text = typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
              return (
                <Typography key={key} variant="caption" sx={{ px: 1, py: 0.25, border: '1px solid', borderColor: 'divider', borderRadius: 1, color: 'text.secondary' }}>
                  {label}:{' '}
                  <Box component="span" sx={{ fontFamily: key === 'stepId' ? 'monospace' : undefined, color: 'text.primary' }}>
                    {text}
                  </Box>
                </Typography>
              );
            })}
          </Stack>
        )}
        {!hasHistory ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            History is not available, so this step's input and result can't be shown.
          </Typography>
        ) : (
          <>
            {detail.error && (
              <Box sx={{ px: 1.5, py: 1, borderRadius: 1, border: '1px solid', borderColor: 'error.main', color: 'error.main', bgcolor: (t) => alpha(t.palette.error.main, 0.08) }}>
                <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                  Error
                </Typography>
                <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                  {detail.error}
                </Typography>
              </Box>
            )}
            {detail.input !== null ? (
              <StructuredValue title="Input" raw={detail.input} environmentId={environmentId} />
            ) : (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                No input recorded for this step.
              </Typography>
            )}
            {detail.result !== null ? (
              <StructuredValue title="Result" raw={detail.result} environmentId={environmentId} />
            ) : (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {detail.status === 'COMPLETED' ? 'This step completed with no return value.' : detail.status ? 'No result — this step has not completed.' : 'No result recorded for this step.'}
              </Typography>
            )}
          </>
        )}
      </Stack>
    </Box>
  );
}
