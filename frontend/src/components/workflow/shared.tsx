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

import { Alert, Box, Button, Card, Chip, Collapse, Divider, Drawer, Link, ListingTable, Stack, Tooltip, Typography } from '@wso2/oxygen-ui';
import { ChevronRight } from '@wso2/oxygen-ui-icons-react';
import { useState, type JSX, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { resourceUrl, useScope } from '../../nav';
import CodeViewer from '../CodeViewer';
import { displayWorkflowId, sectionTitleSx, STATUS_COLORS } from './helpers';
import { useLayout } from '../../contexts/LayoutContext';
import { X } from '@wso2/oxygen-ui-icons-react';

export interface WorkflowScope {
  componentId: string;
  environmentId: string;
}

/**
 * Returns a handler that opens the Workflows admin view pre-filtered by a workflow ID — the same
 * destination as the start-workflow dialog's "View Running Workflow" action.
 */
function useViewWorkflowById(environmentId: string): (workflowId: string) => void {
  const navigate = useNavigate();
  const scope = useScope();
  return (workflowId: string) => {
    navigate(`${resourceUrl(scope, 'workflows')}?tab=management&workflowId=${encodeURIComponent(workflowId)}&env=${encodeURIComponent(environmentId)}`);
  };
}

/** Renders a workflow ID as a monospace link that opens the Workflows admin view filtered by that ID. */
export function WorkflowIdLink({ workflowId, environmentId, onNavigate }: { workflowId?: string; environmentId: string; onNavigate?: () => void }): JSX.Element {
  const viewWorkflow = useViewWorkflowById(environmentId);
  if (!workflowId) return <Typography sx={{ fontFamily: 'monospace', fontSize: 12 }}>—</Typography>;
  return (
    <Link
      component="button"
      type="button"
      title={workflowId}
      onClick={(e) => {
        e.stopPropagation();
        onNavigate?.();
        viewWorkflow(workflowId);
      }}
      sx={{ fontFamily: 'monospace', fontSize: 12, textAlign: 'left', wordBreak: 'break-all', cursor: 'pointer', color: 'text.primary', textDecorationColor: 'inherit' }}>
      {displayWorkflowId(workflowId)}
    </Link>
  );
}

/**
 * The full-page detail surface every workflow entity shares: a right drawer covering everything but
 * the left navigation, with a fixed header (title, status, close), a scrollable body, and a pinned
 * action bar. Human tasks and reviews used to open in a small modal while workflow instances got
 * this; the information density is the same, so the surface now is too.
 */
export function DetailDrawer({ title, status, onClose, actions, children }: { title: ReactNode; status?: string; onClose: () => void; actions?: ReactNode; children: ReactNode }): JSX.Element {
  const { sidebarWidth } = useLayout();
  return (
    <Drawer
      anchor="right"
      open
      variant="persistent"
      onClose={onClose}
      sx={{ '& .MuiDrawer-paper': { width: `calc(100% - ${sidebarWidth}px)`, position: 'fixed', top: 64, height: 'calc(100% - 64px)', borderLeft: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column' } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} sx={{ px: 3, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
        <Stack direction="row" alignItems="center" gap={1.5} sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" component="div" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </Typography>
          {status && <StatusChip status={status} />}
        </Stack>
        <Button size="small" onClick={onClose} sx={{ minWidth: 0, px: 1 }} aria-label="close">
          <X size={16} />
        </Button>
      </Stack>
      <Box sx={{ flex: 1, overflow: 'auto', px: 3, py: 2.5 }}>
        <Box sx={{ maxWidth: 860 }}>{children}</Box>
      </Box>
      {actions && (
        <Stack direction="row" alignItems="center" gap={1} sx={{ px: 3, py: 1.5, borderTop: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
          {actions}
        </Stack>
      )}
    </Drawer>
  );
}

/** A titled section card used through the task and review drawers. */
export function SectionCard({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <Card variant="outlined" sx={{ bgcolor: 'action.hover' }}>
      <Typography variant="subtitle2" sx={{ px: 2, py: 1.5, ...sectionTitleSx }}>
        {title}
      </Typography>
      <Divider />
      <Box sx={{ px: 2, py: 2 }}>{children}</Box>
    </Card>
  );
}

/** One offered action: what it does in a sentence, then the button that starts it. */
export function ActionRow({ caption, button }: { caption: string; button: ReactNode }): JSX.Element {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
      <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
        {caption}
      </Typography>
      <Box sx={{ flexShrink: 0 }}>{button}</Box>
    </Stack>
  );
}

/**
 * Under every listing: how much is on screen, and how to get the rest. A page that happens to be
 * complete is otherwise indistinguishable from one that was silently cut off. With `onLoadMore`
 * the rest is one click away; without it (a listing whose filters run client-side over a bounded
 * fetch) the honest advice is to narrow the filters.
 */
export function ListFooter({ count, singular, plural, hasMore, loadingMore, onLoadMore }: { count: number; singular: string; plural: string; hasMore: boolean; loadingMore?: boolean; onLoadMore?: () => void }): JSX.Element {
  return (
    <Stack direction="row" alignItems="center" justifyContent="center" gap={1.5} sx={{ mt: 1.5 }}>
      <Typography variant="caption" color="text.secondary">
        Showing {count} {count === 1 ? singular : plural}
        {hasMore ? (onLoadMore ? ' — more available' : ' — more exist; narrow the filters to see them') : ''}
      </Typography>
      {hasMore && onLoadMore && (
        <Button size="small" variant="outlined" disabled={loadingMore} onClick={onLoadMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </Stack>
  );
}

/** A listing-column header that explains its concept on hover — run ids especially need the sentence. */
export function HeaderCell({ label, help }: { label: string; help: string }): JSX.Element {
  return (
    <ListingTable.Cell>
      <Tooltip title={help} placement="top">
        <Typography component="span" variant="inherit" sx={{ cursor: 'help', textDecoration: 'underline dotted', textUnderlineOffset: 3, textDecorationColor: 'rgba(128,128,128,0.5)' }}>
          {label}
        </Typography>
      </Tooltip>
    </ListingTable.Cell>
  );
}

/** Renders a status string as a colour-coded chip. */
export function StatusChip({ status }: { status?: string }): JSX.Element {
  const normalized = (status ?? '').toUpperCase();
  const color = STATUS_COLORS[normalized] ?? 'default';
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase().replace(/_/g, ' ') : '—';
  return <Chip label={label} size="small" color={color} variant="outlined" />;
}

/** A label/value row used in task and activity detail cards. String children render as body text. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <Stack direction="row" gap={2}>
      <Typography variant="body2" sx={{ width: 140, flexShrink: 0, fontWeight: 600, color: 'text.disabled' }}>
        {label}
      </Typography>
      {typeof children === 'string' ? (
        <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
          {children}
        </Typography>
      ) : (
        children
      )}
    </Stack>
  );
}

/**
 * Dialog-level banner for a submission the runtime rejected. Generated forms only pre-check required
 * fields and type coercion, so schema constraints (pattern / minimum / format / nested shape) are
 * caught server-side — and that message has to be shown inline, because a toast pops behind the open
 * dialog it belongs to. Renders nothing when there is no error.
 */
export function SubmitError({ message, onClear }: { message: string | null; onClear: () => void }): JSX.Element | null {
  if (!message) return null;
  return (
    <Alert severity="error" onClose={onClear} sx={{ '& .MuiAlert-message': { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }}>
      {message}
    </Alert>
  );
}

/** A compact, theme-consistent expandable panel for revealing a JSON schema/payload. */
export function SchemaDisclosure({ schema, label = 'Click to see Input Schema' }: { schema: string; label?: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
      <Stack
        direction="row"
        alignItems="center"
        gap={0.5}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        sx={{ px: 1.5, py: 1, cursor: 'pointer', userSelect: 'none', bgcolor: 'action.hover', '&:hover': { bgcolor: 'action.selected' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}>
        <ChevronRight size={16} style={{ transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none', flexShrink: 0 }} />
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {label}
        </Typography>
      </Stack>
      <Collapse in={open}>
        <Box sx={{ p: 1 }}>
          <CodeViewer code={schema} language="json" showCopyButton maxHeight="40vh" showLineNumbers={false} />
        </Box>
      </Collapse>
    </Box>
  );
}
