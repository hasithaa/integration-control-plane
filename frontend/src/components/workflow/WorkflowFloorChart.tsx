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

import { alpha, Box, IconButton, Stack, Tooltip, Typography, useTheme, type Theme } from '@wso2/oxygen-ui';
import { Clock, Minus, Plus, TriangleAlert, X } from '@wso2/oxygen-ui-icons-react';
import { useMemo, useState, type ReactElement } from 'react';
import type { InstanceGraph, ModelGraphNode, StepExecution } from '../../api/workflows';
import CodeViewer from '../CodeViewer';
import { ARM_LABEL_H, isContainer, layoutFloorPlan, PAD_TOP, PILL_H, PILL_W, type FloorPlan, type PlacedArm, type PlacedNode } from './floorPlan';
import { extractNodeExecutionDetail, formatDuration } from './helpers';
import { StatusChip } from './shared';
import { paletteColor, statusColorName, typeLabel } from './graphVisuals';

// ── Text ──

/** SVG has no text-overflow, so long labels are cut to what the box can hold. */
const clip = (text: string, maxChars: number): string => (text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1))}…`);

/** Header for a control-flow block: the construct, then the condition or looped expression. */
function containerTitle(node: ModelGraphNode): string {
  const construct = node.stepId.split('#')[0];
  const kind = node.kind.toUpperCase();
  const prefix = kind === 'TRY' ? 'do / on fail' : construct;
  return node.label ? `${prefix} · ${clip(node.label, 46)}` : prefix;
}

/** The name a step box shows: what it calls, falling back to its id for control-flow-only nodes. */
const stepTitle = (node: ModelGraphNode): string => node.target ?? node.stepId;

// ── Colour ──

interface Palette {
  /** Ran: coloured by outcome. Did not run: the disabled grey that greys out an untaken path. */
  ink: string;
  border: string;
  dashed: boolean;
}

function stepPalette(theme: Theme, exec: StepExecution | undefined, reachable: boolean): Palette {
  if (exec) {
    const color = paletteColor(theme, statusColorName(exec.status));
    return { ink: color, border: color, dashed: false };
  }
  // Not executed. On an untaken arm that is expected; on a taken one it simply hasn't been reached yet.
  return { ink: theme.palette.text.disabled, border: theme.palette.divider, dashed: reachable };
}

// ── Drawing ──

const ARROW_ID = 'wf-floor-arrow';
const ARROW_MUTED_ID = 'wf-floor-arrow-muted';

/** A straight connector between two boxes stacked on the same centre line. */
function Connector({ x, y1, y2, color, muted }: { x: number; y1: number; y2: number; color: string; muted: boolean }) {
  if (y2 - y1 < 2) return null;
  return <line x1={x} y1={y1} x2={x} y2={y2} stroke={color} strokeWidth={1.5} strokeDasharray={muted ? '4 4' : undefined} markerEnd={`url(#${muted ? ARROW_MUTED_ID : ARROW_ID})`} />;
}

/** The elbow from a block's header down into one arm's column. */
function ArmEntry({ fromX, fromY, toX, toY, color, muted }: { fromX: number; fromY: number; toX: number; toY: number; color: string; muted: boolean }) {
  const midY = fromY + Math.max(6, (toY - fromY) / 2);
  return <path d={`M ${fromX} ${fromY} V ${midY} H ${toX} V ${toY}`} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray={muted ? '4 4' : undefined} markerEnd={`url(#${muted ? ARROW_MUTED_ID : ARROW_ID})`} />;
}

/**
 * A loop's back edge: down the outside of the block and up to its header, so the repeat reads as a
 * cycle without crossing anything inside.
 */
function RepeatEdge({ box, color, muted }: { box: PlacedNode; color: string; muted: boolean }) {
  const left = box.x - 9;
  const bottom = box.y + box.h - 12;
  const top = box.y + PAD_TOP - 8;
  return (
    <>
      <path d={`M ${box.x + 12} ${bottom} H ${left} V ${top} H ${box.x + 12}`} fill="none" stroke={color} strokeWidth={1.25} strokeDasharray={muted ? '4 4' : undefined} markerEnd={`url(#${muted ? ARROW_MUTED_ID : ARROW_ID})`} />
      <text x={left - 4} y={(top + bottom) / 2} fill={color} fontSize={9} textAnchor="end" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        repeat
      </text>
    </>
  );
}

/** An arm's name chip. A taken arm is stated in the accent colour; an untaken one is greyed. */
function ArmLabel({ arm, taken, theme }: { arm: PlacedArm; taken: boolean; theme: Theme }) {
  const color = taken ? theme.palette.primary.main : theme.palette.text.disabled;
  const label = clip(arm.name || 'body', 22);
  const w = Math.max(34, label.length * 6.2 + 14);
  return (
    <g>
      <rect x={arm.x + (arm.w - w) / 2} y={arm.y} width={w} height={ARM_LABEL_H - 6} rx={(ARM_LABEL_H - 6) / 2} fill={alpha(color, 0.12)} stroke={color} strokeWidth={taken ? 1 : 0.75} strokeDasharray={taken ? undefined : '3 3'} />
      <text x={arm.x + arm.w / 2} y={arm.y + ARM_LABEL_H - 11} fill={color} fontSize={10} fontWeight={700} textAnchor="middle" style={{ letterSpacing: 0.3 }}>
        {label}
      </text>
    </g>
  );
}

/** Placeholder for an arm the author left empty (an `if` with no `else`) — the path still exists. */
function EmptyArm({ arm, theme }: { arm: PlacedArm; theme: Theme }) {
  return (
    <text x={arm.x + arm.w / 2} y={arm.y + ARM_LABEL_H + 16} fill={theme.palette.text.disabled} fontSize={10} textAnchor="middle" fontStyle="italic">
      no steps
    </text>
  );
}

/** One step: a box coloured by what happened to it, with a badge when it ran more than once. */
function StepBox({ box, exec, reachable, selected, theme, onSelect }: { box: PlacedNode; exec: StepExecution | undefined; reachable: boolean; selected: boolean; theme: Theme; onSelect: () => void }) {
  const { ink, border, dashed } = stepPalette(theme, exec, reachable);
  const title = stepTitle(box.node);
  const reviews = exec?.reviews?.length ?? 0;
  const caption = [typeLabel(box.node.kind), box.node.stepId].join(' · ');

  return (
    <g role="button" tabIndex={0} aria-label={`${title}, ${exec ? (exec.status ?? 'ran') : 'not reached'}`} onClick={onSelect} onKeyDown={(e) => ((e as unknown as { key: string }).key === 'Enter' ? onSelect() : undefined)} style={{ cursor: 'pointer' }}>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={7} fill={theme.palette.background.paper} stroke={selected ? ink : border} strokeWidth={selected ? 2 : 1} strokeDasharray={dashed ? '5 4' : undefined} />
      {/* The status bar. Kept inside the rounded corner rather than clipped, so it reads as part of the box. */}
      <rect x={box.x + 1} y={box.y + 1} width={4} height={box.h - 2} rx={2} fill={ink} />
      <text x={box.x + 16} y={box.y + 24} fill={exec ? theme.palette.text.primary : theme.palette.text.disabled} fontSize={13} fontWeight={600}>
        {clip(title, 24)}
      </text>
      <text x={box.x + 16} y={box.y + 42} fill={theme.palette.text.secondary} fontSize={10}>
        {clip(caption, 30)}
      </text>
      {exec && exec.count > 1 && (
        <>
          <rect x={box.x + box.w - 42} y={box.y + 10} width={32} height={17} rx={8.5} fill={alpha(ink, 0.14)} stroke={ink} strokeWidth={0.75} />
          <text x={box.x + box.w - 26} y={box.y + 22} fill={ink} fontSize={10} fontWeight={700} textAnchor="middle">
            {`×${exec.count}`}
          </text>
        </>
      )}
      {reviews > 0 && (
        <>
          <circle cx={box.x + box.w - 20} cy={box.y + box.h - 18} r={7} fill={alpha(theme.palette.warning.main, 0.16)} stroke={theme.palette.warning.main} strokeWidth={0.75} />
          <text x={box.x + box.w - 20} y={box.y + box.h - 14.5} fill={theme.palette.warning.main} fontSize={9} fontWeight={700} textAnchor="middle">
            {reviews}
          </text>
        </>
      )}
    </g>
  );
}

/** A Start / End pill. Non-interactive: neither is a step, they mark where the plan begins and ends. */
function Pill({ x, y, label, color }: { x: number; y: number; label: string; color: string }) {
  return (
    <g>
      <rect x={x} y={y} width={PILL_W} height={PILL_H} rx={PILL_H / 2} fill={alpha(color, 0.1)} stroke={color} strokeWidth={1} />
      <text x={x + PILL_W / 2} y={y + PILL_H / 2 + 4} fill={color} fontSize={11} fontWeight={700} textAnchor="middle" style={{ letterSpacing: 0.6 }}>
        {label}
      </text>
    </g>
  );
}

// ── Recursive render ──

interface RenderCtx {
  theme: Theme;
  steps: Record<string, StepExecution>;
  takenArms: Record<string, string[]>;
  selectedId: string | null;
  onSelect: (stepId: string) => void;
}

/**
 * Draws one node and, for a block, its arms and everything inside them.
 *
 * "Reachable" propagates down: a step on an arm the run never took is drawn flat grey, because it was
 * never going to run, while an unexecuted step on a taken arm is drawn as pending. Nothing in the
 * history says which way a condition evaluated — an arm is known to be taken only because something
 * inside it ran — so this is the strongest statement the data supports.
 */
function renderNode(box: PlacedNode, ctx: RenderCtx, reachable: boolean): ReactElement {
  const { theme, steps, takenArms } = ctx;
  const node = box.node;
  const exec = steps[node.stepId];

  if (!isContainer(node.kind)) {
    return <StepBox key={node.stepId} box={box} exec={exec} reachable={reachable} selected={ctx.selectedId === node.stepId} theme={theme} onSelect={() => ctx.onSelect(node.stepId)} />;
  }

  const taken = takenArms[node.stepId] ?? [];
  const entered = taken.length > 0;
  const headerInk = entered ? theme.palette.text.primary : theme.palette.text.disabled;
  const lineColor = entered ? theme.palette.text.disabled : theme.palette.divider;
  const isLoop = node.kind.toUpperCase() === 'LOOP';

  return (
    <g key={node.stepId}>
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={9}
        fill={alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.04 : 0.02)}
        stroke={entered ? theme.palette.divider : alpha(theme.palette.divider, 0.6)}
        strokeWidth={1}
        strokeDasharray="6 4"
      />
      <text x={box.x + 12} y={box.y + 20} fill={headerInk} fontSize={11} fontWeight={700} style={{ letterSpacing: 0.3 }}>
        {clip(containerTitle(node), Math.floor((box.w - 24) / 6.4))}
      </text>
      {isLoop && <RepeatEdge box={box} color={lineColor} muted={!entered} />}

      {box.arms.map((arm) => {
        const armTaken = taken.includes(arm.name);
        const armReachable = reachable && armTaken;
        const firstChild = arm.children[0];
        return (
          <g key={`${node.stepId}/${arm.name}`} opacity={armTaken || !entered ? 1 : 0.45}>
            <ArmLabel arm={arm} taken={armTaken} theme={theme} />
            {arm.empty && <EmptyArm arm={arm} theme={theme} />}
            {firstChild && <ArmEntry fromX={box.x + box.w / 2} fromY={box.y + PAD_TOP - 10} toX={firstChild.x + firstChild.w / 2} toY={firstChild.y - 2} color={armTaken ? lineColor : theme.palette.divider} muted={!armTaken} />}
            {arm.children.map((child, i) => {
              const prev = arm.children[i - 1];
              return (
                <g key={child.node.stepId}>
                  {prev && <Connector x={child.x + child.w / 2} y1={prev.y + prev.h} y2={child.y - 2} color={armTaken ? lineColor : theme.palette.divider} muted={!armTaken} />}
                  {renderNode(child, ctx, armReachable)}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

// ── Detail panel ──

/**
 * What happened at the selected step. The endpoint supplies the outcome; the input and result come
 * from the raw history, looked up by the event id that step recorded — one per execution, so a loop
 * iteration can be inspected on its own.
 */
function StepDetailPanel({ node, exec, events, onClose }: { node: ModelGraphNode; exec: StepExecution | undefined; events: Array<Record<string, unknown>>; onClose: () => void }) {
  const [iteration, setIteration] = useState(0);
  // Memoised so the fallback empty array isn't a fresh identity on every render, which would make the
  // detail lookup below re-run for no reason.
  const eventIds = useMemo(() => exec?.eventIds ?? [], [exec]);
  const index = Math.min(iteration, Math.max(0, eventIds.length - 1));
  const detail = useMemo(() => (eventIds.length > 0 ? extractNodeExecutionDetail({ id: eventIds[index], type: exec?.type ?? node.kind, status: exec?.status }, events) : null), [eventIds, index, exec, node.kind, events]);

  return (
    <Box sx={{ width: { xs: '100%', md: '42%' }, flexShrink: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', alignSelf: 'stretch' }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1} sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={stepTitle(node)}>
            {stepTitle(node)}
          </Typography>
          <Stack direction="row" alignItems="center" gap={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {typeLabel(node.kind)}
            </Typography>
            {/* The step id is what a diagram and a log line have in common, so it is worth showing. */}
            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
              {node.stepId}
            </Typography>
            {exec?.status && <StatusChip status={exec.status} />}
            {detail?.durationMs != null && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Clock size={13} />
                {formatDuration(detail.durationMs)}
              </Typography>
            )}
          </Stack>
        </Stack>
        <IconButton size="small" aria-label="close step details" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </Stack>

      <Stack gap={2} sx={{ p: 2 }}>
        {!exec ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            This step did not run in this instance. It is part of the workflow, on a path this run did not take or has not reached.
          </Typography>
        ) : (
          <>
            {exec.count > 1 && (
              <Stack direction="row" alignItems="center" gap={0.75} sx={{ flexWrap: 'wrap' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', mr: 0.5 }}>
                  Ran {exec.count} times:
                </Typography>
                {eventIds.map((_, i) => (
                  <Box
                    key={i}
                    component="button"
                    onClick={() => setIteration(i)}
                    sx={{
                      border: '1px solid',
                      borderColor: i === index ? 'primary.main' : 'divider',
                      bgcolor: i === index ? (t) => alpha(t.palette.primary.main, 0.1) : 'transparent',
                      color: i === index ? 'primary.main' : 'text.secondary',
                      borderRadius: 1,
                      px: 0.75,
                      py: 0.25,
                      font: 'inherit',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}>
                    {i + 1}
                  </Box>
                ))}
              </Stack>
            )}
            {exec.childWorkflowId && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Child workflow:{' '}
                <Box component="span" sx={{ fontFamily: 'monospace' }}>
                  {exec.childWorkflowId}
                </Box>
              </Typography>
            )}
            {exec.reviews && exec.reviews.length > 0 && (
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.25 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
                  Reviews
                </Typography>
                {/* Drawn here rather than as steps of their own: a review gates this step, it is not another one. */}
                {exec.reviews.map((r, i) => (
                  <Stack key={i} direction="row" alignItems="center" gap={1} sx={{ mt: 0.5 }}>
                    <Typography variant="body2" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.label ?? 'review'}
                    </Typography>
                    {r.status && <StatusChip status={r.status} />}
                  </Stack>
                ))}
              </Box>
            )}
            {(exec.failure || detail?.error) && (
              <Box sx={{ px: 1.5, py: 1, borderRadius: 1, border: '1px solid', borderColor: 'error.main', color: 'error.main', bgcolor: (t) => alpha(t.palette.error.main, 0.08) }}>
                <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                  Error
                </Typography>
                <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                  {detail?.error ?? exec.failure}
                </Typography>
              </Box>
            )}
            {events.length === 0 ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                History is not available, so this step's input and result can't be shown.
              </Typography>
            ) : (
              <>
                {detail?.input != null && <CodeViewer code={detail.input} language="json" title="Input" height="26vh" expandable showLineNumbers={false} />}
                {detail?.result != null && <CodeViewer code={detail.result} language="json" title="Result" height="26vh" expandable showLineNumbers={false} />}
              </>
            )}
          </>
        )}
      </Stack>
    </Box>
  );
}

// ── Root ──

const ZOOM_STEP = 0.15;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.6;

/**
 * Draws a workflow instance as a floor plan: the workflow's whole structure, with the path this run
 * took highlighted through it.
 *
 * This is the view the flat execution graph could not give. Because the model comes from the
 * descriptor rather than the history, steps that never ran are still drawn — greyed, on the arm they
 * sit in — so an operator can see where a run stopped and what it skipped, not merely what it did.
 */
export default function WorkflowFloorChart({ data, events = [] }: { data: InstanceGraph; events?: Array<Record<string, unknown>> }) {
  const theme = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const graph = data.graph;
  const plan: FloorPlan | null = useMemo(() => (graph && graph.nodes && graph.nodes.length > 0 ? layoutFloorPlan(graph) : null), [graph]);
  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.stepId, n])), [graph]);
  const runFinished = !['RUNNING', 'SUSPENDED'].includes((data.status ?? '').toUpperCase());

  if (!plan) {
    return <Typography sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>This workflow has no published structure, so its flow can't be drawn. Redeploy the integration with a current runtime to publish one.</Typography>;
  }

  const selectedNode = selectedId ? nodeById.get(selectedId) : undefined;
  const ctx: RenderCtx = { theme, steps: data.steps ?? {}, takenArms: data.takenArms ?? {}, selectedId, onSelect: (id) => setSelectedId((cur) => (cur === id ? null : id)) };
  const lineColor = theme.palette.text.disabled;
  const endColor = runFinished ? paletteColor(theme, statusColorName(data.status)) : theme.palette.text.disabled;
  const unmatched = data.unmatched ?? [];
  // Every step would be drawn as "not reached", which is not what happened — so say why instead.
  const unanchored = data.stepIdsAvailable === false;

  return (
    <Stack gap={1.5}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} sx={{ flexWrap: 'wrap' }}>
        <Stack direction="row" alignItems="center" gap={2} sx={{ flexWrap: 'wrap' }}>
          {graph?.file && (
            <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
              {graph.file}
            </Typography>
          )}
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {unanchored ? "This is the workflow's structure; this run could not be placed on it." : 'Highlighted arms are the paths this run took. Greyed steps did not run.'}
          </Typography>
          {unanchored && (
            <Tooltip title="Step ids are read by the runtime that answers this request. A project shares one Temporal engine, so this run may have been read through an integration built against an older workflow module. Redeploy that integration to see the path taken.">
              <Stack direction="row" alignItems="center" gap={0.5} sx={{ color: 'warning.main' }}>
                <TriangleAlert size={13} />
                <Typography variant="caption">Run not anchored</Typography>
              </Stack>
            </Tooltip>
          )}
          {unmatched.length > 0 && !unanchored && (
            // Reported, not hidden: an unplaceable step means the run and the drawing disagree, which
            // an operator needs to know before trusting the picture.
            <Tooltip title={unmatched.map((u) => `${u.label ?? 'step'} — ${u.reason ?? 'unmatched'}`).join('\n')}>
              <Stack direction="row" alignItems="center" gap={0.5} sx={{ color: 'warning.main' }}>
                <TriangleAlert size={13} />
                <Typography variant="caption">
                  {unmatched.length} executed {unmatched.length === 1 ? 'step' : 'steps'} not shown
                </Typography>
              </Stack>
            </Tooltip>
          )}
        </Stack>
        <Stack direction="row" alignItems="center" gap={0.5}>
          <IconButton size="small" aria-label="zoom out" disabled={zoom <= ZOOM_MIN + 0.01} onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}>
            <Minus size={14} />
          </IconButton>
          <Typography variant="caption" sx={{ color: 'text.secondary', width: 36, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </Typography>
          <IconButton size="small" aria-label="zoom in" disabled={zoom >= ZOOM_MAX - 0.01} onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}>
            <Plus size={14} />
          </IconButton>
        </Stack>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} gap={2} alignItems="flex-start">
        <Box sx={{ flex: 1, minWidth: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'auto', maxHeight: '62vh', bgcolor: 'action.hover' }}>
          <svg width={plan.width * zoom} height={plan.height * zoom} viewBox={`0 0 ${plan.width} ${plan.height}`} role="img" aria-label={`Flow of ${data.workflowType}`} style={{ display: 'block', margin: '0 auto' }}>
            <defs>
              <marker id={ARROW_ID} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={lineColor} />
              </marker>
              <marker id={ARROW_MUTED_ID} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.palette.divider} />
              </marker>
            </defs>

            <Pill x={plan.start.x} y={plan.start.y} label="START" color={theme.palette.primary.main} />
            <Connector x={plan.axis} y1={plan.start.y + PILL_H} y2={(plan.nodes[0]?.y ?? plan.end.y) - 2} color={lineColor} muted={false} />

            {plan.nodes.map((box, i) => {
              const prev = plan.nodes[i - 1];
              return (
                <g key={box.node.stepId}>
                  {prev && <Connector x={plan.axis} y1={prev.y + prev.h} y2={box.y - 2} color={lineColor} muted={false} />}
                  {renderNode(box, ctx, true)}
                </g>
              );
            })}

            <Connector x={plan.axis} y1={(plan.nodes[plan.nodes.length - 1]?.y ?? plan.start.y) + (plan.nodes[plan.nodes.length - 1]?.h ?? PILL_H)} y2={plan.end.y - 2} color={lineColor} muted={false} />
            <Pill x={plan.end.x} y={plan.end.y} label={runFinished ? (data.status ?? 'END') : 'END'} color={endColor} />
          </svg>
        </Box>
        {selectedNode && <StepDetailPanel node={selectedNode} exec={(data.steps ?? {})[selectedNode.stepId]} events={events} onClose={() => setSelectedId(null)} />}
      </Stack>
    </Stack>
  );
}
