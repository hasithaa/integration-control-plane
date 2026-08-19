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

/**
 * A JSON value read the way its shape wants to be read. An object's primitive fields become
 * labelled rows — a human task's envelope, a flat workflow input — nested fields keep a JSON block
 * each, and a bare value (a string result, a number) is one compact value box rather than a
 * full-height code viewer. The braces toggle always reaches the raw JSON, because a form is a
 * rendering and a rendering can be wrong; copy always copies the raw value.
 */
export default function StructuredValue({ title, raw }: { title: string; raw: string }): ReactElement {
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

  const entries = Object.entries(parsed as Record<string, unknown>);
  const flat = entries.filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v));
  const nested = entries.filter(([k]) => !flat.some(([fk]) => fk === k));
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, minWidth: 0 }}>
      {header}
      <Stack gap={0.5} sx={{ px: 1.5, py: 1, minWidth: 0 }}>
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
