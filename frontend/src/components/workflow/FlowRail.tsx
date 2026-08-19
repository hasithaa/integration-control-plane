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

import { alpha, Box, Stack, Tooltip, Typography, useTheme } from '@wso2/oxygen-ui';
import { ChevronDown, ChevronRight, Diamond, GitBranch, Info, RefreshCw, Repeat, Shield } from '@wso2/oxygen-ui-icons-react';
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactElement, type ReactNode } from 'react';
import type { InstanceGraph, ModelGraphNode, StepExecution } from '../../api/workflows';
import { iconForType, paletteColor, statusColorName } from './graphVisuals';

/**
 * The flow rail: the workflow as written, rendered the way it is written — a left-aligned list,
 * one element per row, nesting as indentation, keywords lowercase, `else` on the same level as its
 * `if`, exactly like reading the source. A list cannot be clipped the way a two-dimensional
 * drawing can, which is what makes it fit beside the execution graph without hiding anything.
 *
 * The execution path is painted in the execution graph's own vocabulary — the same status→colour
 * mapping, so green is completed, blue running, red failed on both sides of the split. Everything
 * else the rail says is static; clicking a step filters the execution graph to that step's events.
 */

interface TreeNode {
  node: ModelGraphNode;
  arms: { name: string; children: TreeNode[] }[];
}

/** The nodes (already in source order) as a tree, arms in first-appearance order. */
function buildTree(nodes: ModelGraphNode[]): TreeNode[] {
  const known = new Set(nodes.map((n) => n.stepId));
  const byId = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  for (const node of nodes) {
    const tree: TreeNode = { node, arms: [] };
    byId.set(node.stepId, tree);
    const parent = node.parent && known.has(node.parent) ? byId.get(node.parent) : undefined;
    if (!parent) {
      roots.push(tree);
      continue;
    }
    const armName = node.branch ?? '';
    let arm = parent.arms.find((a) => a.name === armName);
    if (!arm) {
      arm = { name: armName, children: [] };
      parent.arms.push(arm);
    }
    arm.children.push(tree);
  }
  return roots;
}

const CONTAINER_KINDS = new Set(['BRANCH', 'LOOP', 'TRY']);
const MARK_KINDS = new Set(['CODE', 'EXIT']);

/** The construct as written — `if`, `while`, `foreach`, `match`, `do` — from the ordinal id. */
const constructOf = (node: ModelGraphNode): string => node.stepId.split('#')[0];

const CONSTRUCT_ICONS: Record<string, ComponentType<{ size?: number }>> = {
  if: Diamond,
  match: GitBranch,
  while: RefreshCw,
  foreach: Repeat,
  do: Shield,
};

/** Lowercase, keyword-first, like the source: `if req.priority == "express"`. */
function containerTitle(node: ModelGraphNode, prefix = ''): string {
  const construct = constructOf(node);
  return `${prefix}${construct}${node.label ? ` ${node.label}` : ''}`;
}

function KeywordRow({
  depth,
  icon: Icon,
  text,
  title,
  collapsed,
  onToggle,
  collapsedStatusColor,
  chart,
}: {
  depth: number;
  icon?: ComponentType<{ size?: number }>;
  text: string;
  title?: string;
  /** Present only on rows that can collapse; undefined renders a plain keyword row. */
  collapsed?: boolean;
  onToggle?: () => void;
  /** Aggregate colour of what a collapsed row hides, so folding never hides an outcome. */
  collapsedStatusColor?: string;
  chart?: boolean;
}): ReactElement {
  const toggle = onToggle !== undefined;
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={0.5}
      role={toggle ? 'button' : undefined}
      tabIndex={toggle ? 0 : undefined}
      onClick={onToggle}
      onKeyDown={toggle ? (e) => (e.key === 'Enter' ? onToggle?.() : undefined) : undefined}
      sx={{
        pl: chart ? 0.75 : 1 + depth * 1.5,
        pr: 1,
        py: 0.4,
        color: 'text.secondary',
        minWidth: 0,
        cursor: toggle ? 'pointer' : 'default',
        borderRadius: 1,
        ...(chart && { border: '1px dashed', borderColor: 'divider', ml: 0.5 + depth * 1.5, pl: 0.75, my: 0.25, width: 'fit-content', maxWidth: '100%' }),
        '&:hover': toggle ? { bgcolor: (t) => alpha(t.palette.primary.main, 0.05) } : undefined,
      }}>
      {toggle && <Box sx={{ display: 'flex', flexShrink: 0 }}>{collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</Box>}
      {Icon && (
        <Box sx={{ flexShrink: 0, display: 'flex' }}>
          <Icon size={12} />
        </Box>
      )}
      <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 11.5, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={title ?? text}>
        {text}
      </Typography>
      {collapsed && collapsedStatusColor && (
        <Tooltip title="Steps inside ran — expand to see them">
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: collapsedStatusColor, flexShrink: 0 }} />
        </Tooltip>
      )}
    </Stack>
  );
}

function StepRow({
  node,
  exec,
  depth,
  selected,
  isCurrent,
  onSelect,
  rowRef,
  chart = false,
}: {
  node: ModelGraphNode;
  exec: StepExecution | undefined;
  depth: number;
  selected: boolean;
  isCurrent: boolean;
  onSelect: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
  chart?: boolean;
}): ReactElement {
  const theme = useTheme();
  const ran = exec !== undefined;
  // The execution graph's own status→colour mapping, so both panes speak one vocabulary.
  const statusColor = ran ? paletteColor(theme, statusColorName(exec.status)) : theme.palette.text.disabled;
  const Icon = iconForType(node.kind);
  const title = node.target ?? node.stepId;
  // Failed at some point, but the latest execution succeeded — a retry or a review decision. Worth
  // a mark, or the green here would quietly erase a failure the history still shows.
  const recovered = ran && exec.failure !== undefined && (exec.status ?? '').toUpperCase() === 'COMPLETED';
  return (
    <Box
      ref={rowRef}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' ? onSelect() : undefined)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        pl: chart ? 0.75 : 1 + depth * 1.5,
        pr: 1,
        py: 0.5,
        cursor: 'pointer',
        borderRadius: 1,
        // The execution path as a line down the rail: executed rows carry their status colour.
        borderLeft: '3px solid',
        borderLeftColor: ran ? statusColor : 'transparent',
        // Chart mode: each line is one boxed item, indented by nesting — a single-column flowchart.
        ...(chart && {
          border: '1px solid',
          borderColor: ran ? statusColor : 'divider',
          borderLeft: '3px solid',
          bgcolor: 'background.paper',
          ml: 0.5 + depth * 1.5,
          pl: 0.75,
          my: 0.25,
          width: 'fit-content',
          maxWidth: '100%',
          minWidth: 140,
        }),
        bgcolor: selected ? (t) => alpha(t.palette.primary.main, 0.12) : 'transparent',
        outline: selected ? '1px solid' : 'none',
        outlineColor: 'primary.main',
        '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.06) },
        color: ran ? 'text.primary' : 'text.disabled',
      }}>
      <Box sx={{ color: statusColor, display: 'flex', flexShrink: 0 }}>
        <Icon size={13} />
      </Box>
      <Typography
        variant="body2"
        sx={{ fontWeight: ran ? 600 : 400, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1 }}
        title={`${title} · ${node.stepId}${ran ? ` · ${exec.status ?? ''}` : ' · not executed'}`}>
        {title}
      </Typography>
      {recovered && (
        <Tooltip title="Failed earlier in this run; the latest execution succeeded">
          <Box sx={{ color: 'warning.main', display: 'flex', flexShrink: 0 }}>
            <Info size={12} />
          </Box>
        </Tooltip>
      )}
      {isCurrent && (
        <Tooltip title="Last executed step (approximate)">
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: statusColor, flexShrink: 0 }} />
        </Tooltip>
      )}
      {exec && exec.count > 1 && (
        <Typography variant="caption" sx={{ color: statusColor, fontWeight: 700, fontSize: 10.5, flexShrink: 0 }}>
          ×{exec.count}
        </Typography>
      )}
    </Box>
  );
}

export default function FlowRail({
  data,
  selectedStepId,
  currentStepId,
  onSelect,
  variant = 'chart',
}: {
  data: InstanceGraph;
  selectedStepId: string | null;
  currentStepId: string | null;
  onSelect: (stepId: string | null) => void;
  /** 'chart' boxes each row, one item per row; 'uml' draws the same rows as a UML activity diagram. */
  variant?: 'chart' | 'uml';
}): ReactElement | null {
  const theme = useTheme();
  const graph = data.graph;
  const tree = useMemo(() => (graph && graph.nodes ? buildTree(graph.nodes) : []), [graph]);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const chart = true; // rows are always boxed now; 'uml' swaps the whole renderer below

  // The reverse link: when the execution graph names a step, bring its row into view.
  useEffect(() => {
    if (!selectedStepId) return;
    rowRefs.current.get(selectedStepId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedStepId]);

  if (tree.length === 0) return null;
  const steps = data.steps ?? {};

  const toggle = (stepId: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });

  /** Aggregate status of everything under these nodes: the worst outcome wins, so folding hides nothing. */
  const aggregateStatusColor = (children: TreeNode[]): string | undefined => {
    let best: string | undefined;
    const rank = (status: string): number => (['FAILED', 'TERMINATED', 'TIMED_OUT'].includes(status) ? 3 : status === 'RUNNING' ? 2 : 1);
    let bestRank = 0;
    const walk = (n: TreeNode) => {
      const exec = steps[n.node.stepId];
      if (exec) {
        const status = (exec.status ?? '').toUpperCase();
        const r = rank(status);
        if (r > bestRank) {
          bestRank = r;
          best = paletteColor(theme, statusColorName(status));
        }
      }
      n.arms.forEach((a) => a.children.forEach(walk));
    };
    children.forEach(walk);
    return best;
  };

  /** One foldable group of rows: a keyword row and the children it hides when collapsed. */
  const foldableGroup = (key: string, children: TreeNode[], childDepth: number, keyword: (folded: boolean) => ReactNode): ReactNode => {
    const folded = collapsed.has(key);
    return (
      <Box key={key}>
        {keyword(folded)}
        {!folded && children.map((child) => renderNode(child, childDepth))}
      </Box>
    );
  };

  const renderStep = (t: TreeNode, depth: number): ReactNode => (
    <StepRow
      key={t.node.stepId}
      node={t.node}
      exec={steps[t.node.stepId]}
      depth={depth}
      selected={selectedStepId === t.node.stepId}
      isCurrent={currentStepId === t.node.stepId}
      onSelect={() => onSelect(selectedStepId === t.node.stepId ? null : t.node.stepId)}
      chart={chart}
      rowRef={(el) => {
        if (el) rowRefs.current.set(t.node.stepId, el);
        else rowRefs.current.delete(t.node.stepId);
      }}
    />
  );

  /**
   * A container the way the source spells it: the keyword row, then each arm by its own rule —
   * `then`/`body`/`do` children sit directly under the keyword (the arm name adds nothing a reader
   * of code expects to see), `else` returns to the keyword's own indent, an `else` holding only
   * another `if` collapses to `else if`, `on fail` reads as its two words, and a match's patterns
   * read as case labels one level in.
   */
  const renderContainer = (t: TreeNode, depth: number, prefix = ''): ReactNode => {
    const Icon = CONSTRUCT_ICONS[constructOf(t.node)] ?? Diamond;
    const isCollapsed = collapsed.has(t.node.stepId);
    const rows: ReactNode[] = [
      <KeywordRow
        key={t.node.stepId}
        depth={depth}
        icon={Icon}
        text={containerTitle(t.node, prefix)}
        title={`${containerTitle(t.node, prefix)} · ${t.node.stepId}`}
        collapsed={isCollapsed}
        onToggle={() => toggle(t.node.stepId)}
        collapsedStatusColor={isCollapsed ? aggregateStatusColor(t.arms.flatMap((a) => a.children)) : undefined}
        chart={chart}
      />,
    ];
    if (isCollapsed) {
      return <Box key={`c-${t.node.stepId}${prefix}`}>{rows}</Box>;
    }
    for (const arm of t.arms) {
      if (arm.name === 'then' || arm.name === 'body' || arm.name === 'do' || arm.name === '') {
        rows.push(arm.children.map((child) => renderNode(child, depth + 1)));
      } else if (arm.name === 'else') {
        const only = arm.children.length === 1 ? arm.children[0] : null;
        if (only && only.node.kind.toUpperCase() === 'BRANCH' && constructOf(only.node) === 'if') {
          rows.push(renderContainer(only, depth, 'else '));
        } else {
          // A keyword group folds exactly like a container: same chevron, same aggregate dot.
          const key = `${t.node.stepId}/else`;
          rows.push(foldableGroup(key, arm.children, depth + 1, (folded) => <KeywordRow depth={depth} text="else" chart={chart} collapsed={folded} onToggle={() => toggle(key)} collapsedStatusColor={folded ? aggregateStatusColor(arm.children) : undefined} />));
        }
      } else if (arm.name === 'onFail') {
        const key = `${t.node.stepId}/onFail`;
        rows.push(
          foldableGroup(key, arm.children, depth + 1, (folded) => (
            <KeywordRow depth={depth} icon={Shield} text="on fail" chart={chart} collapsed={folded} onToggle={() => toggle(key)} collapsedStatusColor={folded ? aggregateStatusColor(arm.children) : undefined} />
          )),
        );
      } else {
        // A match clause's patterns, or any arm name this rail does not know: a case label.
        const key = `${t.node.stepId}/${arm.name}`;
        rows.push(
          foldableGroup(key, arm.children, depth + 2, (folded) => <KeywordRow depth={depth + 1} text={arm.name} chart={chart} collapsed={folded} onToggle={() => toggle(key)} collapsedStatusColor={folded ? aggregateStatusColor(arm.children) : undefined} />),
        );
      }
    }
    return <Box key={`c-${t.node.stepId}${prefix}`}>{rows}</Box>;
  };

  const renderNode = (t: TreeNode, depth: number): ReactNode => {
    const kind = t.node.kind.toUpperCase();
    if (MARK_KINDS.has(kind)) {
      const label = kind === 'EXIT' ? `↩ ${(t.node as { mode?: string }).mode ?? 'exit'}` : 'data processing';
      return (
        <Typography
          key={t.node.stepId}
          variant="caption"
          title={t.node.label ?? undefined}
          sx={{ display: 'block', pl: 1 + depth * 1.5 + 2.5, py: 0.25, color: 'text.disabled', fontStyle: 'italic', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </Typography>
      );
    }
    if (CONTAINER_KINDS.has(kind)) {
      return renderContainer(t, depth);
    }
    return renderStep(t, depth);
  };

  if (variant === 'uml') {
    return (
      <Box sx={{ overflow: 'auto', height: '100%', py: 1, px: 0.5 }}>
        <UmlActivityDiagram tree={tree} steps={steps} selectedStepId={selectedStepId} currentStepId={currentStepId} onSelect={onSelect} />
      </Box>
    );
  }

  return <Stack sx={{ overflow: 'auto', height: '100%', py: 1, px: 0.5 }}>{tree.map((t) => renderNode(t, 0))}</Stack>;
}

// ── UML activity diagram ─────────────────────────────────────────────────────

const UML_ROW_H = 30;
const UML_BOX_H = 22;
const UML_INDENT = 16;
const UML_X0 = 16;
const UML_W = 300;

interface UmlRow {
  kind: 'start' | 'end' | 'action' | 'decision' | 'final';
  node?: ModelGraphNode;
  depth: number;
  /** Guard on the incoming edge — `[then]`, `[else]`, `[body]`, a pattern. */
  guard?: string;
  text: string;
  tooltip?: string;
  dashed?: boolean;
  /** For loop rows: indexes of the body's rows, so the back edge knows where it leaves from. */
  loop?: boolean;
  terminal?: boolean;
}

/**
 * The same structure as a UML activity diagram, kept exactly as compact as the chart: one element
 * per row, arms as guarded edges rather than label rows, decisions as diamonds, exits as final
 * nodes, and a loop's repetition drawn as a gutter edge back to its head.
 */
function UmlActivityDiagram({
  tree,
  steps,
  selectedStepId,
  currentStepId,
  onSelect,
}: {
  tree: TreeNode[];
  steps: Record<string, StepExecution>;
  selectedStepId: string | null;
  currentStepId: string | null;
  onSelect: (stepId: string | null) => void;
}): ReactElement {
  const theme = useTheme();

  // Flatten the tree into rows, guards riding on the first row of each arm.
  const rows: UmlRow[] = [{ kind: 'start', depth: 0, text: '' }];
  const loopBacks: { from: number; to: number }[] = [];
  const walk = (nodes: TreeNode[], depth: number, guard?: string) => {
    let pendingGuard = guard;
    for (const t of nodes) {
      const kind = t.node.kind.toUpperCase();
      if (kind === 'CODE') {
        rows.push({ kind: 'action', node: t.node, depth, guard: pendingGuard, text: 'data processing', tooltip: t.node.label ?? undefined, dashed: true });
      } else if (kind === 'EXIT') {
        rows.push({ kind: 'final', node: t.node, depth, guard: pendingGuard, text: (t.node as { mode?: string }).mode ?? 'exit', terminal: true });
      } else if (kind === 'BRANCH' || kind === 'LOOP' || kind === 'TRY') {
        const construct = constructOf(t.node);
        const isLoop = kind === 'LOOP';
        rows.push({ kind: 'decision', node: t.node, depth, guard: pendingGuard, text: `${construct}${t.node.label ? ` ${t.node.label}` : ''}`, loop: isLoop });
        const headIndex = rows.length - 1;
        for (const arm of t.arms) {
          const armGuard = arm.name === '' || arm.name === 'then' || arm.name === 'body' || arm.name === 'do' ? (isLoop ? '[body]' : arm.name === 'do' ? undefined : `[${arm.name || 'in'}]`) : `[${arm.name}]`;
          walk(arm.children, depth + 1, armGuard);
        }
        if (isLoop && rows.length - 1 > headIndex) {
          loopBacks.push({ from: rows.length - 1, to: headIndex });
        }
      } else {
        rows.push({ kind: 'action', node: t.node, depth, guard: pendingGuard, text: t.node.target ?? t.node.stepId });
      }
      pendingGuard = undefined;
    }
  };
  walk(tree, 0);
  rows.push({ kind: 'end', depth: 0, text: '' });

  const height = rows.length * UML_ROW_H + 8;
  const xOf = (row: UmlRow) => UML_X0 + row.depth * UML_INDENT;
  const yOf = (i: number) => i * UML_ROW_H + 4;
  const line = theme.palette.text.disabled;

  return (
    <svg width={UML_W} height={height} viewBox={`0 0 ${UML_W} ${height}`} role="img" aria-label="UML activity diagram" style={{ display: 'block' }}>
      <defs>
        <marker id="uml-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={line} />
        </marker>
      </defs>

      {/* Edges: each non-terminal row flows to the next, jogging when the indent changes. */}
      {rows.map((row, i) => {
        const next = rows[i + 1];
        if (!next || row.terminal) return null;
        const x1 = xOf(row) + 9;
        const x2 = xOf(next) + 9;
        const y1 = yOf(i) + UML_BOX_H;
        const y2 = yOf(i + 1);
        const midY = (y1 + y2) / 2;
        const d = x1 === x2 ? `M ${x1} ${y1} L ${x2} ${y2}` : `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
        return (
          <g key={`e-${i}`}>
            <path d={d} fill="none" stroke={line} strokeWidth={1} markerEnd="url(#uml-arrow)" />
            {next.guard && (
              <text x={Math.max(x1, x2) + 6} y={midY + 3} fill={theme.palette.text.secondary} fontSize={8.5} fontFamily="monospace">
                {next.guard}
              </text>
            )}
          </g>
        );
      })}

      {/* Loop back edges, in the gutter left of the loop's head. */}
      {loopBacks.map(({ from, to }, i) => {
        const gx = xOf(rows[to]) - 6;
        const y1 = yOf(from) + UML_BOX_H / 2;
        const y2 = yOf(to) + UML_BOX_H / 2;
        const xFrom = xOf(rows[from]) + 2;
        const xTo = xOf(rows[to]) + 2;
        return <path key={`lb-${i}`} d={`M ${xFrom} ${y1} L ${gx} ${y1} L ${gx} ${y2} L ${xTo} ${y2}`} fill="none" stroke={line} strokeWidth={1} strokeDasharray="3 3" markerEnd="url(#uml-arrow)" />;
      })}

      {rows.map((row, i) => {
        const y = yOf(i);
        const x = xOf(row);
        if (row.kind === 'start') {
          return <circle key={i} cx={x + 9} cy={y + UML_BOX_H / 2} r={5.5} fill={theme.palette.text.primary} />;
        }
        if (row.kind === 'end') {
          return (
            <g key={i}>
              <circle cx={x + 9} cy={y + UML_BOX_H / 2} r={6.5} fill="none" stroke={theme.palette.text.primary} strokeWidth={1.25} />
              <circle cx={x + 9} cy={y + UML_BOX_H / 2} r={3.5} fill={theme.palette.text.primary} />
            </g>
          );
        }
        if (row.kind === 'final') {
          return (
            <g key={i}>
              <circle cx={x + 9} cy={y + UML_BOX_H / 2} r={6} fill="none" stroke={line} strokeWidth={1.25} />
              <circle cx={x + 9} cy={y + UML_BOX_H / 2} r={3} fill={line} />
              <text x={x + 20} y={y + UML_BOX_H / 2 + 3.5} fill={theme.palette.text.disabled} fontSize={10} fontStyle="italic">
                {row.text}
              </text>
            </g>
          );
        }
        if (row.kind === 'decision') {
          const cx = x + 9;
          const cy = y + UML_BOX_H / 2;
          const r = 7;
          return (
            <g key={i}>
              <path d={`M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`} fill={theme.palette.background.paper} stroke={line} strokeWidth={1.25} />
              <text x={x + 22} y={cy + 3.5} fill={theme.palette.text.secondary} fontSize={10} fontWeight={700} fontFamily="monospace">
                {row.text.length > 34 ? `${row.text.slice(0, 33)}…` : row.text}
              </text>
            </g>
          );
        }
        // An action: the rounded rectangle, status-coloured when it ran.
        const node = row.node;
        const exec = node ? steps[node.stepId] : undefined;
        const ran = exec !== undefined;
        const statusColor = ran ? paletteColor(theme, statusColorName(exec.status)) : theme.palette.divider;
        const selected = node != null && selectedStepId === node.stepId;
        const isCurrent = node != null && currentStepId === node.stepId;
        const w = Math.min(UML_W - x - 24, Math.max(90, row.text.length * 6.4 + 24));
        const clickable = node != null && !row.dashed;
        return (
          <g
            key={i}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => onSelect(selected ? null : node.stepId) : undefined}
            onKeyDown={clickable ? (e) => ((e as unknown as { key: string }).key === 'Enter' ? onSelect(selected ? null : node.stepId) : undefined) : undefined}
            style={{ cursor: clickable ? 'pointer' : 'default' }}>
            <title>{row.tooltip ?? (node ? `${row.text} · ${node.stepId}${ran ? ` · ${exec.status ?? ''}` : ' · not executed'}` : row.text)}</title>
            <rect
              x={x}
              y={y}
              width={w}
              height={UML_BOX_H}
              rx={UML_BOX_H / 2}
              fill={selected ? alpha(theme.palette.primary.main, 0.12) : theme.palette.background.paper}
              stroke={selected ? theme.palette.primary.main : statusColor}
              strokeWidth={selected ? 1.75 : ran ? 1.5 : 1}
              strokeDasharray={row.dashed ? '3 3' : ran ? undefined : '4 3'}
            />
            {isCurrent && <circle cx={x + w - 10} cy={y + UML_BOX_H / 2} r={3} fill={statusColor} />}
            <text x={x + 10} y={y + UML_BOX_H / 2 + 3.5} fill={ran ? theme.palette.text.primary : theme.palette.text.disabled} fontSize={10.5} fontWeight={ran ? 600 : 400} fontStyle={row.dashed ? 'italic' : undefined}>
              {row.text.length > Math.floor(w / 6.4) ? `${row.text.slice(0, Math.floor(w / 6.4) - 1)}…` : row.text}
            </text>
            {exec && exec.count > 1 && (
              <text x={x + w - (isCurrent ? 20 : 8)} y={y + UML_BOX_H / 2 + 3.5} fill={statusColor} fontSize={9} fontWeight={700} textAnchor="end">
                ×{exec.count}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
