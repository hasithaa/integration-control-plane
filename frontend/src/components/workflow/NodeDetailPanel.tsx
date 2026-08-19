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
import { Clock, Copy, X } from '@wso2/oxygen-ui-icons-react';
import type { ExecutionGraphNode } from '../../api/workflows';
import CodeViewer from '../CodeViewer';
import { formatDuration, humanizeKey, splitQualifiedName, type NodeExecutionDetail } from './helpers';
import { StatusChip } from './shared';
import { typeLabel } from './graphVisuals';

/** Side panel showing a selected node's execution time, input and result, mapped from the history. */
/**
 * A JSON value broken into a form when its shape allows it: an object's primitive fields become
 * labelled rows — which is how a human task's envelope (task name, roles, parent workflow) and a
 * flat workflow input want to be read — while nested fields keep a JSON block each, and anything
 * that is not an object stays a JSON block wholesale. Copy always copies the raw value.
 */
function StructuredValue({ title, raw }: { title: string; raw: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined || parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return <CodeViewer code={raw} language="json" title={title} height="30vh" expandable showLineNumbers={false} />;
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  const flat = entries.filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v));
  const nested = entries.filter(([k]) => !flat.some(([fk]) => fk === k));
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <IconButton size="small" aria-label={`copy ${title.toLowerCase()}`} onClick={() => navigator.clipboard.writeText(raw)} sx={{ p: 0.25 }}>
          <Copy size={12} />
        </IconButton>
      </Stack>
      <Stack gap={0.5} sx={{ px: 1.5, py: 1 }}>
        {flat.map(([key, value]) => (
          <Stack key={key} direction="row" gap={1} alignItems="baseline" sx={{ minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', width: 132, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={key}>
              {humanizeKey(key)}
            </Typography>
            <Typography variant="body2" sx={{ minWidth: 0, wordBreak: 'break-word', fontFamily: typeof value === 'string' && /id$/i.test(key) ? 'monospace' : undefined, fontSize: 12.5 }}>
              {value === null ? '—' : typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value === '' ? '—' : value)}
            </Typography>
          </Stack>
        ))}
        {nested.map(([key, value]) => (
          <CodeViewer key={key} code={JSON.stringify(value, null, 2)} language="json" title={humanizeKey(key)} height="16vh" expandable showLineNumbers={false} />
        ))}
      </Stack>
    </Box>
  );
}

export default function NodeDetailPanel({ node, detail, hasHistory, onClose, fullWidth = false }: { node: ExecutionGraphNode; detail: NodeExecutionDetail; hasHistory: boolean; onClose: () => void; fullWidth?: boolean }) {
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
              <StructuredValue title="Input" raw={detail.input} />
            ) : (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                No input recorded for this step.
              </Typography>
            )}
            {detail.result !== null ? (
              <StructuredValue title="Result" raw={detail.result} />
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
