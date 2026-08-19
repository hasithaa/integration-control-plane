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
import { Diamond, GitBranch, Info, RefreshCw, Repeat, Shield } from '@wso2/oxygen-ui-icons-react';
import { useEffect, useMemo, useRef, type ComponentType, type ReactElement, type ReactNode } from 'react';
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

function KeywordRow({ depth, icon: Icon, text, title }: { depth: number; icon?: ComponentType<{ size?: number }>; text: string; title?: string }): ReactElement {
  return (
    <Stack direction="row" alignItems="center" gap={0.75} sx={{ pl: 1 + depth * 1.5, pr: 1, py: 0.4, color: 'text.secondary', minWidth: 0 }}>
      {Icon && (
        <Box sx={{ flexShrink: 0, display: 'flex' }}>
          <Icon size={12} />
        </Box>
      )}
      <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 11.5, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={title ?? text}>
        {text}
      </Typography>
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
}: {
  node: ModelGraphNode;
  exec: StepExecution | undefined;
  depth: number;
  selected: boolean;
  isCurrent: boolean;
  onSelect: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
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
        pl: 1 + depth * 1.5,
        pr: 1,
        py: 0.5,
        cursor: 'pointer',
        borderRadius: 1,
        // The execution path as a line down the rail: executed rows carry their status colour.
        borderLeft: '3px solid',
        borderLeftColor: ran ? statusColor : 'transparent',
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

export default function FlowRail({ data, selectedStepId, currentStepId, onSelect }: { data: InstanceGraph; selectedStepId: string | null; currentStepId: string | null; onSelect: (stepId: string | null) => void }): ReactElement | null {
  const graph = data.graph;
  const tree = useMemo(() => (graph && graph.nodes ? buildTree(graph.nodes) : []), [graph]);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  // The reverse link: when the execution graph names a step, bring its row into view.
  useEffect(() => {
    if (!selectedStepId) return;
    rowRefs.current.get(selectedStepId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedStepId]);

  if (tree.length === 0) return null;
  const steps = data.steps ?? {};

  const renderStep = (t: TreeNode, depth: number): ReactNode => (
    <StepRow
      key={t.node.stepId}
      node={t.node}
      exec={steps[t.node.stepId]}
      depth={depth}
      selected={selectedStepId === t.node.stepId}
      isCurrent={currentStepId === t.node.stepId}
      onSelect={() => onSelect(selectedStepId === t.node.stepId ? null : t.node.stepId)}
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
    const rows: ReactNode[] = [<KeywordRow key={t.node.stepId} depth={depth} icon={Icon} text={containerTitle(t.node, prefix)} title={`${containerTitle(t.node, prefix)} · ${t.node.stepId}`} />];
    for (const arm of t.arms) {
      if (arm.name === 'then' || arm.name === 'body' || arm.name === 'do' || arm.name === '') {
        rows.push(arm.children.map((child) => renderNode(child, depth + 1)));
      } else if (arm.name === 'else') {
        const only = arm.children.length === 1 ? arm.children[0] : null;
        if (only && only.node.kind.toUpperCase() === 'BRANCH' && constructOf(only.node) === 'if') {
          rows.push(renderContainer(only, depth, 'else '));
        } else {
          rows.push(<KeywordRow key={`${t.node.stepId}/else`} depth={depth} text="else" />);
          rows.push(arm.children.map((child) => renderNode(child, depth + 1)));
        }
      } else if (arm.name === 'onFail') {
        rows.push(<KeywordRow key={`${t.node.stepId}/onFail`} depth={depth} icon={Shield} text="on fail" />);
        rows.push(arm.children.map((child) => renderNode(child, depth + 1)));
      } else {
        // A match clause's patterns, or any arm name this rail does not know: a case label.
        rows.push(<KeywordRow key={`${t.node.stepId}/${arm.name}`} depth={depth + 1} text={arm.name} />);
        rows.push(arm.children.map((child) => renderNode(child, depth + 2)));
      }
    }
    return <Box key={`c-${t.node.stepId}${prefix}`}>{rows}</Box>;
  };

  const renderNode = (t: TreeNode, depth: number): ReactNode => {
    const kind = t.node.kind.toUpperCase();
    if (MARK_KINDS.has(kind)) {
      const label = kind === 'EXIT' ? `↩ ${(t.node as { mode?: string }).mode ?? 'exit'}` : (t.node.label ?? 'code');
      return (
        <Typography key={t.node.stepId} variant="caption" sx={{ display: 'block', pl: 1 + depth * 1.5 + 2.5, py: 0.25, color: 'text.disabled', fontStyle: 'italic', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </Typography>
      );
    }
    if (CONTAINER_KINDS.has(kind)) {
      return renderContainer(t, depth);
    }
    return renderStep(t, depth);
  };

  return <Stack sx={{ overflow: 'auto', height: '100%', py: 1, px: 0.5 }}>{tree.map((t) => renderNode(t, 0))}</Stack>;
}
