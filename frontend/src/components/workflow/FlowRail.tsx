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

import { alpha, Box, useTheme, type Theme } from '@wso2/oxygen-ui';
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import type { InstanceGraph, ModelGraphNode, StepExecution } from '../../api/workflows';
import { ARM_LABEL_H, isContainer, layoutFloorPlan, PILL_H, type PlacedArm, type PlacedNode } from './floorPlan';

/**
 * The flow rail: the workflow's structure as the compiler described it, drawn compactly beside the
 * execution graph. It is a *map*, not a claim about the run — the only runtime it shows is an
 * execution count per step and dimming for steps with no executions, both labelled approximate by
 * the pane that hosts it. Its job is navigation: clicking a step filters the execution graph to
 * that step's own history nodes, which is where the truth lives.
 */

const clip = (text: string, maxChars: number): string => (text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1))}…`);

const stepTitle = (node: ModelGraphNode): string => node.target ?? node.label ?? node.stepId;

function containerTitle(node: ModelGraphNode): string {
  const construct = node.stepId.split('#')[0];
  const prefix = node.kind.toUpperCase() === 'TRY' ? 'do / on fail' : construct;
  return node.label ? `${prefix} · ${clip(node.label, 24)}` : prefix;
}

/** CODE and EXIT nodes are marks on the map, not steps: drawn as slim pills inside the step slot. */
const isMark = (kind: string): boolean => kind.toUpperCase() === 'CODE' || kind.toUpperCase() === 'EXIT';

function StepBox({ box, exec, selected, isCurrent, theme, onSelect }: { box: PlacedNode; exec: StepExecution | undefined; selected: boolean; isCurrent: boolean; theme: Theme; onSelect: () => void }): ReactElement {
  const node = box.node;
  const kind = node.kind.toUpperCase();
  const accent = theme.palette.primary.main;

  if (isMark(kind)) {
    // Never executed, never filterable — display only.
    const label = kind === 'EXIT' ? ((node as { mode?: string }).mode ?? 'exit') : (node.label ?? 'code');
    const h = 20;
    const y = box.y + (box.h - h) / 2;
    return (
      <g>
        <rect x={box.x + box.w * 0.12} y={y} width={box.w * 0.76} height={h} rx={h / 2} fill="none" stroke={theme.palette.divider} strokeWidth={1} strokeDasharray={kind === 'CODE' ? '3 3' : undefined} />
        <text x={box.x + box.w / 2} y={y + 13.5} fill={theme.palette.text.disabled} fontSize={9.5} textAnchor="middle" fontStyle={kind === 'CODE' ? 'italic' : undefined}>
          {clip(kind === 'EXIT' ? `↩ ${label}` : label, 22)}
        </text>
      </g>
    );
  }

  const ran = exec !== undefined;
  const ink = ran ? theme.palette.text.primary : theme.palette.text.disabled;
  return (
    <g role="button" tabIndex={0} aria-label={`${stepTitle(node)}${ran ? '' : ', no executions'}`} onClick={onSelect} onKeyDown={(e) => ((e as unknown as { key: string }).key === 'Enter' ? onSelect() : undefined)} style={{ cursor: 'pointer' }}>
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={6}
        fill={selected ? alpha(accent, 0.12) : theme.palette.background.paper}
        stroke={selected ? accent : ran ? theme.palette.text.secondary : theme.palette.divider}
        strokeWidth={selected ? 1.75 : 1}
        strokeDasharray={ran ? undefined : '4 3'}
      />
      {isCurrent && <circle cx={box.x + 8} cy={box.y + box.h / 2} r={3.5} fill={accent} />}
      <text x={box.x + (isCurrent ? 16 : 10)} y={box.y + box.h / 2 + 3.5} fill={ink} fontSize={11} fontWeight={ran ? 600 : 400}>
        {clip(stepTitle(node), isCurrent ? 16 : 18)}
      </text>
      {exec && exec.count > 1 && (
        <>
          <rect x={box.x + box.w - 30} y={box.y + (box.h - 15) / 2} width={24} height={15} rx={7.5} fill={alpha(accent, 0.12)} />
          <text x={box.x + box.w - 18} y={box.y + box.h / 2 + 3.5} fill={accent} fontSize={9.5} fontWeight={700} textAnchor="middle">
            {`×${exec.count}`}
          </text>
        </>
      )}
    </g>
  );
}

function renderNode(box: PlacedNode, ctx: { theme: Theme; steps: Record<string, StepExecution>; selectedStepId: string | null; currentStepId: string | null; onSelect: (stepId: string) => void }): ReactElement {
  const { theme } = ctx;
  const node = box.node;
  if (!isContainer(node.kind)) {
    return <StepBox key={node.stepId} box={box} exec={ctx.steps[node.stepId]} selected={ctx.selectedStepId === node.stepId} isCurrent={ctx.currentStepId === node.stepId} theme={theme} onSelect={() => ctx.onSelect(node.stepId)} />;
  }
  return (
    <g key={node.stepId}>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={7} fill={alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.035 : 0.02)} stroke={alpha(theme.palette.divider, 0.9)} strokeWidth={1} strokeDasharray="5 3" />
      <text x={box.x + 8} y={box.y + 15} fill={theme.palette.text.secondary} fontSize={9.5} fontWeight={700} style={{ letterSpacing: 0.3 }}>
        {clip(containerTitle(node), Math.floor((box.w - 16) / 5.6))}
      </text>
      {box.arms.map((arm: PlacedArm) => (
        <g key={`${node.stepId}/${arm.name}`}>
          <text x={arm.x + arm.w / 2} y={arm.y + ARM_LABEL_H - 6} fill={theme.palette.text.disabled} fontSize={8.5} fontWeight={700} textAnchor="middle" style={{ letterSpacing: 0.4, textTransform: 'uppercase' }}>
            {clip(arm.name || 'body', 16)}
          </text>
          {arm.empty && (
            <text x={arm.x + arm.w / 2} y={arm.y + ARM_LABEL_H + 12} fill={theme.palette.text.disabled} fontSize={9} textAnchor="middle" fontStyle="italic">
              —
            </text>
          )}
          {arm.children.map((child) => renderNode(child, ctx))}
        </g>
      ))}
    </g>
  );
}

export default function FlowRail({ data, selectedStepId, currentStepId, onSelect }: { data: InstanceGraph; selectedStepId: string | null; currentStepId: string | null; onSelect: (stepId: string | null) => void }): ReactElement | null {
  const theme = useTheme();
  const scroller = useRef<HTMLDivElement>(null);
  const graph = data.graph;
  const plan = useMemo(() => (graph && graph.nodes && graph.nodes.length > 0 ? layoutFloorPlan(graph) : null), [graph]);

  // The reverse link: when the execution graph names a step, bring it into view here.
  useEffect(() => {
    if (!selectedStepId || !scroller.current || !plan) return;
    const walk = (nodes: typeof plan.nodes): { y: number } | null => {
      for (const n of nodes) {
        if (n.node.stepId === selectedStepId) return { y: n.y };
        for (const arm of n.arms) {
          const hit = walk(arm.children);
          if (hit) return hit;
        }
      }
      return null;
    };
    const hit = walk(plan.nodes);
    if (hit) scroller.current.scrollTo({ top: Math.max(0, hit.y - 80), behavior: 'smooth' });
  }, [selectedStepId, plan]);

  if (!plan) return null;

  const ctx = { theme, steps: data.steps ?? {}, selectedStepId, currentStepId, onSelect: (id: string) => onSelect(selectedStepId === id ? null : id) };
  const lineColor = theme.palette.text.disabled;

  return (
    <Box ref={scroller} sx={{ overflow: 'auto', height: '100%', px: 0.5 }}>
      <svg width={plan.width} height={plan.height} viewBox={`0 0 ${plan.width} ${plan.height}`} role="img" aria-label={`Flow of ${data.workflowType}`} style={{ display: 'block', margin: '0 auto' }}>
        <g>
          <rect x={plan.start.x} y={plan.start.y} width={84} height={PILL_H} rx={PILL_H / 2} fill={alpha(theme.palette.primary.main, 0.1)} stroke={theme.palette.primary.main} strokeWidth={1} />
          <text x={plan.start.x + 42} y={plan.start.y + PILL_H / 2 + 3.5} fill={theme.palette.primary.main} fontSize={9.5} fontWeight={700} textAnchor="middle" style={{ letterSpacing: 0.5 }}>
            START
          </text>
        </g>
        {plan.nodes.map((box, i) => {
          const prev = plan.nodes[i - 1];
          const y1 = prev ? prev.y + prev.h : plan.start.y + PILL_H;
          return (
            <g key={box.node.stepId}>
              <line x1={plan.axis} y1={y1} x2={plan.axis} y2={box.y - 1} stroke={lineColor} strokeWidth={1} />
              {renderNode(box, ctx)}
            </g>
          );
        })}
        <line x1={plan.axis} y1={(plan.nodes[plan.nodes.length - 1]?.y ?? plan.start.y) + (plan.nodes[plan.nodes.length - 1]?.h ?? PILL_H)} x2={plan.axis} y2={plan.end.y - 1} stroke={lineColor} strokeWidth={1} />
        <g>
          <rect x={plan.end.x} y={plan.end.y} width={84} height={PILL_H} rx={PILL_H / 2} fill="none" stroke={lineColor} strokeWidth={1} />
          <text x={plan.end.x + 42} y={plan.end.y + PILL_H / 2 + 3.5} fill={theme.palette.text.secondary} fontSize={9.5} fontWeight={700} textAnchor="middle" style={{ letterSpacing: 0.5 }}>
            END
          </text>
        </g>
      </svg>
    </Box>
  );
}
