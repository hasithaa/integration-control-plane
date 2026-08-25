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

import { Alert, Box, Button, Card, CardActionArea, Chip, CircularProgress, Collapse, Divider, Drawer, IconButton, Link, ListingTable, Menu, MenuItem, Stack, Tooltip, Typography } from '@wso2/oxygen-ui';
import { ChevronDown, ChevronRight, Copy, EllipsisVertical, Info } from '@wso2/oxygen-ui-icons-react';
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

/** Middle-ellipsizes a long identifier: `8ee1613c-5795-…-abf552fae5bb` reads as well as the
 *  whole thing and stops a 36-character UUID from dominating a label column. */
export function truncateId(id: string, head = 8, tail = 6): string {
  return id.length <= head + tail + 1 ? id : `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/**
 * Renders a workflow ID as a monospace link that opens the Workflows admin view filtered by that
 * ID. `truncate` middle-ellipsizes it (full value in the title and in the copy), and `copy` adds a
 * clipboard button — detail views ask for both, so a long UUID neither dominates the row nor loses
 * the one thing anyone does with it.
 */
export function WorkflowIdLink({ workflowId, environmentId, onNavigate, truncate, copy }: { workflowId?: string; environmentId: string; onNavigate?: () => void; truncate?: boolean; copy?: boolean }): JSX.Element {
  const viewWorkflow = useViewWorkflowById(environmentId);
  if (!workflowId) return <NotProvided />;
  const shown = displayWorkflowId(workflowId);
  return (
    <Stack direction="row" alignItems="center" gap={0.25} sx={{ minWidth: 0 }}>
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
        {truncate ? truncateId(shown) : shown}
      </Link>
      {copy && (
        <Tooltip title="Copy ID">
          <IconButton
            size="small"
            aria-label="copy workflow id"
            onClick={(e) => {
              e.stopPropagation();
              void navigator.clipboard.writeText(workflowId);
            }}>
            <Copy size={12} />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}

/**
 * The freshness line under a cached view: when the data was produced, that the page refreshes
 * itself — stated, so the periodic update is never a surprise — and, while an answer is being
 * replaced after a mutation, that fresher data is on its way. The data stays visible throughout;
 * blanking a list because it is seconds old would punish every reader for one writer.
 */
export function RefreshingNote({ show, fetchedAt, label = 'refreshing — fetching the latest from the integration…' }: { show: boolean; fetchedAt?: number; label?: string }): JSX.Element | null {
  if (!show && !fetchedAt) return null;
  return (
    <Stack direction="row" alignItems="center" gap={1} sx={{ color: 'text.secondary' }}>
      {show && <CircularProgress size={12} thickness={5} />}
      <Typography variant="caption">
        {fetchedAt ? `Updated ${new Date(fetchedAt * 1000).toLocaleTimeString()} · auto-refreshes` : ''}
        {show ? `${fetchedAt ? ' · ' : ''}${label}` : ''}
      </Typography>
    </Stack>
  );
}

/**
 * A long identifier in a table cell: middle-ellipsized with the full value in the title, and a
 * copy button — the one thing anyone does with an id a list is too narrow to show whole. For ids
 * that navigate, use WorkflowIdLink; this is for the rest (run ids, task ids).
 */
export function IdText({ id, muted }: { id?: string; muted?: boolean }): JSX.Element {
  if (!id) return <NotProvided />;
  return (
    <Stack direction="row" alignItems="center" gap={0.25} sx={{ minWidth: 0 }}>
      <Typography component="span" title={id} sx={{ fontFamily: 'monospace', fontSize: 12, color: muted ? 'text.secondary' : 'text.primary', whiteSpace: 'nowrap' }}>
        {truncateId(id)}
      </Typography>
      <Tooltip title="Copy ID">
        <IconButton
          size="small"
          aria-label="copy id"
          onClick={(e) => {
            e.stopPropagation();
            void navigator.clipboard.writeText(id);
          }}>
          <Copy size={12} />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

/** A missing value stated as such — an em-dash reads as a rendering bug, "Not provided" as a fact. */
export function NotProvided({ label = 'Not provided' }: { label?: string }): JSX.Element {
  return (
    <Typography component="span" variant="body2" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
      {label}
    </Typography>
  );
}

/**
 * The drawer header's overflow menu: fallback and destructive operations live here rather than in
 * their own section, so the page's visual weight stays on the task's purpose. Each item states its
 * consequences in the flow it opens, not in the menu.
 */
export function HeaderMenu({ items }: { items: { label: string; color?: 'warning' | 'error'; disabled?: boolean; onClick: () => void }[] }): JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <IconButton size="small" aria-label="more operations" onClick={(e) => setAnchor(e.currentTarget)}>
        <EllipsisVertical size={16} />
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {items.map((item) => (
          <MenuItem
            key={item.label}
            disabled={item.disabled}
            onClick={() => {
              setAnchor(null);
              item.onClick();
            }}
            sx={item.color ? { color: `${item.color}.main` } : undefined}>
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/**
 * The full-page detail surface every workflow entity shares: a right drawer covering everything but
 * the left navigation, with a fixed header (title, status, close), a scrollable body, and a pinned
 * action bar. Human tasks and reviews used to open in a small modal while workflow instances got
 * this; the information density is the same, so the surface now is too.
 */
export function DetailDrawer({ title, status, onClose, actions, menu, children }: { title: ReactNode; status?: string; onClose: () => void; actions?: ReactNode; menu?: ReactNode; children: ReactNode }): JSX.Element {
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
        <Stack direction="row" alignItems="center" gap={0.5}>
          {menu}
          <Button size="small" onClick={onClose} sx={{ minWidth: 0, px: 1 }} aria-label="close">
            <X size={16} />
          </Button>
        </Stack>
      </Stack>
      <Box sx={{ flex: 1, overflow: 'auto', px: 3, py: 2.5 }}>
        {/* Centered like the listing pages behind it — pinned left, the drawer read as a different
            surface from the lists it opens over. */}
        <Box sx={{ maxWidth: 860, mx: 'auto' }}>{children}</Box>
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
export function SectionCard({ title, collapsible, children }: { title: string; collapsible?: boolean; children: ReactNode }): JSX.Element {
  // Open by default: the context is why the reader is here. Collapsing is for the second visit,
  // once the facts are absorbed and the actions are what is left.
  const [open, setOpen] = useState(true);
  const header = (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.5 }}>
      <Typography variant="subtitle2" sx={sectionTitleSx}>
        {title}
      </Typography>
      {collapsible && <ChevronDown size={14} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s', opacity: 0.6 }} />}
    </Stack>
  );
  return (
    <Card variant="outlined" sx={{ bgcolor: 'action.hover' }}>
      {collapsible ? (
        <CardActionArea onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {header}
        </CardActionArea>
      ) : (
        header
      )}
      {collapsible ? (
        <Collapse in={open}>
          <Divider />
          <Box sx={{ px: 2, py: 2 }}>{children}</Box>
        </Collapse>
      ) : (
        <>
          <Divider />
          <Box sx={{ px: 2, py: 2 }}>{children}</Box>
        </>
      )}
    </Card>
  );
}

/**
 * One action as a card: a bold name, a one-line subtitle, and — when a sentence cannot carry the
 * whole consequence — the full explanation behind an info icon. Cards sit side by side in a grid,
 * so the options are scannable before any is chosen; clicking selects the card and its inputs
 * appear beneath the grid, which keeps the first screen clean without hiding what acting entails.
 */
export function ActionCard({ title, subtitle, info, selected, disabled, disabledReason, onClick }: { title: string; subtitle: string; info?: string; selected?: boolean; disabled?: boolean; disabledReason?: string; onClick: () => void }): JSX.Element {
  const card = (
    <Card
      variant="outlined"
      sx={{
        flex: '1 1 240px',
        maxWidth: 360,
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? 'action.selected' : 'background.paper',
        opacity: disabled ? 0.55 : 1,
      }}>
      <CardActionArea onClick={onClick} disabled={disabled} sx={{ px: 2, py: 1.5, height: '100%' }} aria-pressed={selected}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1}>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {title}
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
              {subtitle}
            </Typography>
          </Box>
          {info && (
            <Tooltip title={info}>
              <Box component="span" onClick={(e) => e.stopPropagation()} sx={{ display: 'inline-flex', color: 'text.disabled', mt: 0.25 }}>
                <Info size={14} />
              </Box>
            </Tooltip>
          )}
        </Stack>
      </CardActionArea>
    </Card>
  );
  return disabled && disabledReason ? (
    <Tooltip title={disabledReason}>
      <span style={{ display: 'flex', flex: '1 1 240px', maxWidth: 360 }}>{card}</span>
    </Tooltip>
  ) : (
    card
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
