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

import { Box, IconButton, Stack, Tooltip, Typography } from '@wso2/oxygen-ui';
import { Braces, Copy } from '@wso2/oxygen-ui-icons-react';
import { useState, type ReactElement } from 'react';
import CodeViewer from '../CodeViewer';
import { humanizeKey } from './helpers';
import { WorkflowIdLink } from './shared';

/**
 * A JSON value read the way its shape wants to be read. An object's primitive fields become
 * labelled rows — a human task's envelope, a flat workflow input — nested fields keep a JSON block
 * each, and a bare value (a string result, a number) is one compact value box rather than a
 * full-height code viewer. The braces toggle always reaches the raw JSON, because a form is a
 * rendering and a rendering can be wrong; copy always copies the raw value.
 */
const isWorkflowId = (value: unknown): value is string => typeof value === 'string' && /^(workflow|humantask|reviewactivity)-/.test(value);

export default function StructuredValue({ title, raw, environmentId }: { title: string; raw: string; environmentId?: string }): ReactElement {
  const [showRaw, setShowRaw] = useState(false);

  let parsed: unknown;
  let parseFailed = false;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parseFailed = true;
  }

  const isFormable = !parseFailed && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  const isBare = !parseFailed && !isFormable && (parsed === null || typeof parsed !== 'object');

  const header = (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography variant="caption" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      <Stack direction="row" alignItems="center" gap={0.25}>
        <Tooltip title={showRaw ? 'Show as a form' : 'Show the raw JSON'}>
          <IconButton size="small" aria-label={`toggle raw ${title.toLowerCase()}`} onClick={() => setShowRaw((v) => !v)} sx={{ p: 0.25, color: showRaw ? 'primary.main' : 'inherit' }}>
            <Braces size={12} />
          </IconButton>
        </Tooltip>
        <Tooltip title={`Copy ${title.toLowerCase()}`}>
          <IconButton size="small" aria-label={`copy ${title.toLowerCase()}`} onClick={() => navigator.clipboard.writeText(raw)} sx={{ p: 0.25 }}>
            <Copy size={12} />
          </IconButton>
        </Tooltip>
      </Stack>
    </Stack>
  );

  // Raw on demand, and raw whenever the value defies structure — unparseable text stays visible.
  if (showRaw || parseFailed || (!isFormable && !isBare)) {
    return (
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, minWidth: 0 }}>
        {header}
        <Box sx={{ p: 1, minWidth: 0, overflow: 'auto', maxHeight: '32vh' }}>
          <Box component="pre" sx={{ m: 0, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {raw}
          </Box>
        </Box>
      </Box>
    );
  }

  if (isBare) {
    return (
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, minWidth: 0 }}>
        {header}
        <Typography sx={{ px: 1.5, py: 1, fontFamily: 'monospace', fontSize: 12.5, wordBreak: 'break-word' }}>{parsed === null ? '—' : String(parsed)}</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, minWidth: 0 }}>
      {header}
      <Box sx={{ px: 1.5, py: 1, minWidth: 0 }}>
        <ObjectRows value={parsed as Record<string, unknown>} depth={0} environmentId={environmentId} />
      </Box>
    </Box>
  );
}

/** Whether every element is a primitive, so an array can read as one line rather than a block. */
const isPrimitiveArray = (v: unknown): v is Array<string | number | boolean | null> => Array.isArray(v) && v.every((e) => e === null || ['string', 'number', 'boolean'].includes(typeof e));

/**
 * An object as labelled rows, recursively: nested plain objects become indented sub-forms — one
 * consistent reading whether the value is a task envelope, its payload, or an activity's argument —
 * with primitive arrays inline and only genuinely deep or mixed values falling back to a JSON
 * block. Ids that name a workflow instance link to it.
 */
function ObjectRows({ value, depth, environmentId }: { value: Record<string, unknown>; depth: number; environmentId?: string }): ReactElement {
  const entries = Object.entries(value);
  return (
    <Stack gap={0.5} sx={{ minWidth: 0, pl: depth * 1.5, borderLeft: depth > 0 ? '2px solid' : 'none', borderColor: 'divider' }}>
      {entries.map(([key, v]) => {
        const label = (
          <Typography variant="caption" sx={{ color: 'text.secondary', width: 132, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={key}>
            {humanizeKey(key)}
          </Typography>
        );
        if (isWorkflowId(v) && environmentId) {
          return (
            <Stack key={key} direction="row" gap={1} alignItems="baseline" sx={{ minWidth: 0 }}>
              {label}
              <WorkflowIdLink workflowId={v} environmentId={environmentId} />
            </Stack>
          );
        }
        if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
          return (
            <Stack key={key} direction="row" gap={1} alignItems="baseline" sx={{ minWidth: 0 }}>
              {label}
              <Typography variant="body2" sx={{ minWidth: 0, wordBreak: 'break-word', fontFamily: typeof v === 'string' && /id$/i.test(key) ? 'monospace' : undefined, fontSize: 12.5 }}>
                {v === null ? '—' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v === '' ? '—' : v)}
              </Typography>
            </Stack>
          );
        }
        if (isPrimitiveArray(v)) {
          return (
            <Stack key={key} direction="row" gap={1} alignItems="baseline" sx={{ minWidth: 0 }}>
              {label}
              <Typography variant="body2" sx={{ minWidth: 0, wordBreak: 'break-word', fontSize: 12.5 }}>
                {v.length === 0 ? '—' : v.map((e) => (e === null ? '—' : String(e))).join(', ')}
              </Typography>
            </Stack>
          );
        }
        if (v !== null && typeof v === 'object' && !Array.isArray(v) && depth < 3) {
          return (
            <Box key={key} sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                {humanizeKey(key)}
              </Typography>
              <ObjectRows value={v as Record<string, unknown>} depth={depth + 1} environmentId={environmentId} />
            </Box>
          );
        }
        return <CodeViewer key={key} code={JSON.stringify(v, null, 2)} language="json" title={humanizeKey(key)} height="14vh" expandable showLineNumbers={false} />;
      })}
    </Stack>
  );
}
