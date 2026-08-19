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

import { alpha, Box, Stack, Tooltip, Typography } from '@wso2/oxygen-ui';
import { useEffect, useMemo, useRef, type ReactElement, type ReactNode } from 'react';
import type { InstanceGraph, ModelGraphNode, StepExecution } from '../../api/workflows';
import { iconForType } from './graphVisuals';

/**
 * The flow rail: the workflow as written, rendered the way it is written — a left-aligned list,
 * one element per row, nesting as indentation, exactly like reading the source. A list cannot be
 * clipped the way a two-dimensional drawing can, which is what makes it fit beside the execution
 * graph without hiding anything.
 *
 * It is a *map*, not a claim about the run: the only runtime it shows is an execution count per
 * step, dimming for steps with no executions, and a "you are here" mark. Its job is navigation —
 * clicking a step filters the execution graph to that step's own history events.
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

function containerTitle(node: ModelGraphNode): string {
  const construct = node.stepId.split('#')[0];
  const prefix = node.kind.toUpperCase() === 'TRY' ? 'do / on fail' : construct;
  return node.label ? `${prefix} · ${node.label}` : prefix;
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
  const ran = exec !== undefined;
  const Icon = iconForType(node.kind);
  const title = node.target ?? node.stepId;
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
        bgcolor: selected ? (t) => alpha(t.palette.primary.main, 0.12) : 'transparent',
        outline: selected ? '1px solid' : 'none',
        outlineColor: 'primary.main',
        '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.06) },
        color: ran ? 'text.primary' : 'text.disabled',
      }}>
      <Icon size={13} />
      <Typography variant="body2" sx={{ fontWeight: ran ? 600 : 400, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1 }} title={`${title} · ${node.stepId}`}>
        {title}
      </Typography>
      {isCurrent && (
        <Tooltip title="Last executed step (approximate)">
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'primary.main', flexShrink: 0 }} />
        </Tooltip>
      )}
      {exec && exec.count > 1 && (
        <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700, fontSize: 10.5, flexShrink: 0 }}>
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
  const scroller = useRef<HTMLDivElement>(null);

  // The reverse link: when the execution graph names a step, bring its row into view.
  useEffect(() => {
    if (!selectedStepId) return;
    rowRefs.current.get(selectedStepId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedStepId]);

  if (tree.length === 0) return null;
  const steps = data.steps ?? {};

  const renderNode = (t: TreeNode, depth: number): ReactNode => {
    const kind = t.node.kind.toUpperCase();
    if (MARK_KINDS.has(kind)) {
      // Marks on the map — code runs, exits — never executed, never filterable.
      const label = kind === 'EXIT' ? `↩ ${(t.node as { mode?: string }).mode ?? 'exit'}` : (t.node.label ?? 'code');
      return (
        <Typography key={t.node.stepId} variant="caption" sx={{ display: 'block', pl: 1 + depth * 1.5 + 2.5, py: 0.25, color: 'text.disabled', fontStyle: 'italic', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </Typography>
      );
    }
    if (CONTAINER_KINDS.has(kind)) {
      return (
        <Box key={t.node.stepId}>
          <Typography
            variant="caption"
            sx={{ display: 'block', pl: 1 + depth * 1.5, pt: 0.75, pb: 0.25, color: 'text.secondary', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={containerTitle(t.node)}>
            {containerTitle(t.node)}
          </Typography>
          {t.arms.map((arm) => (
            <Box key={`${t.node.stepId}/${arm.name}`}>
              <Typography variant="caption" sx={{ display: 'block', pl: 1 + (depth + 1) * 1.5, py: 0.1, color: 'text.disabled', fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                {arm.name || 'body'}
              </Typography>
              {arm.children.map((child) => renderNode(child, depth + 2))}
            </Box>
          ))}
        </Box>
      );
    }
    return (
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
  };

  return (
    <Stack ref={scroller} sx={{ overflow: 'auto', height: '100%', py: 1, px: 0.5 }}>
      {tree.map((t) => renderNode(t, 0))}
    </Stack>
  );
}
