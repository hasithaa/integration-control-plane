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

import { Box, Chip, IconButton, Stack, Tooltip, Typography } from '@wso2/oxygen-ui';
import { GitBranch, List } from '@wso2/oxygen-ui-icons-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { ExecutionGraph as ExecutionGraphData, InstanceGraph, WorkflowInstance } from '../../api/workflows';
import StructuredValue from './StructuredValue';
import AgentRail from './AgentRail';
import AgentStarRail from './AgentStarRail';
import ExecutionSummary from './ExecutionSummary';
import FlowRail from './FlowRail';
import NodeDetailPanel from './NodeDetailPanel';
import WorkflowTimeline from './WorkflowTimeline';
import { buildTimeline, extractNodeExecutionDetail, extractWorkflowInput, flowUnavailable, jsonPretty, signalEventIds, type TimelineSpan } from './helpers';

/**
 * The instance's Overview: everything an operator reads first, on one page.
 *
 *   summary cards (start input · execution summary)
 *   [ flow / agent rail ] [ timeline — or the execution graph, one toggle away ]
 *
 * The rail is the program as the compiler described it — structure. The timeline is the run as it
 * happened — time. Between them they answer both dimensions without repeating each other, which is
 * why the timeline (not the execution graph) sits in the hero position: duration, order and gaps
 * are what the graph could never say. The join is navigation in both directions: clicking a rail
 * step dims every timeline span but that step's own executions; clicking a span's name opens its
 * details and names its step back on the rail.
 *
 * Agents join by the same step ids — the runtime stamps every agent call with its star node
 * (model, tool:<name>, task:<name>) — with two client-side refinements: data events are signals
 * (matched here by name), and the model's calls split into one rail row per built-in activity
 * (`model#<activity>`), because Thinking and Generate Result mean different things to a reader.
 */

export default function WorkflowFlowTab({
  instanceGraph,
  executionGraph,
  events,
  info,
  onOpenHistory,
  environmentId,
}: {
  instanceGraph: InstanceGraph | undefined;
  executionGraph: ExecutionGraphData | undefined;
  events: Array<Record<string, unknown>>;
  info: WorkflowInstance | undefined;
  onOpenHistory?: () => void;
  environmentId?: string;
}) {
  // The rail's selection is the filter; the right pane's selection reports back into the rail.
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [railHighlight, setRailHighlight] = useState<string | null>(null);
  const [railVariant, setRailVariant] = useState<'chart' | 'uml'>('chart');
  // The rail's share of the split, resizable by the divider. 40/60 by default.
  const [railPct, setRailPct] = useState(40);
  const splitRef = useRef<HTMLDivElement>(null);
  const startResize = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const rect = splitRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      setRailPct(Math.min(70, Math.max(20, ((ev.clientX - rect.left) / rect.width) * 100)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const [selectedSpan, setSelectedSpan] = useState<TimelineSpan | null>(null);

  const isAgent = instanceGraph?.graphKind === 'agent';
  const reason = flowUnavailable(instanceGraph);
  const startInput = extractWorkflowInput(events);
  // The instances payload carries no times; the history does. The spans stay around so a rail
  // click can name the first execution it filtered to.
  const timeline = useMemo(() => buildTimeline(events), [events]);
  const historyRange = timeline.spans.length > 0 ? { start: timeline.start, end: timeline.end } : null;
  // The run's real result: the instances payload reports null, the terminal event does not.
  const workflowResult = useMemo(() => extractNodeExecutionDetail({ id: '', type: 'WORKFLOW' }, events).result, [events]);

  // The last executed step, for the rail's "you are here" mark. Approximate by nature. An
  // agent's model events answer to the split rail row, not the shared model node.
  const currentStepId = useMemo(() => {
    if (!executionGraph) return null;
    const nodes = executionGraph.nodes ?? [];
    for (let i = nodes.length - 1; i >= 0; i--) {
      const stepId = nodes[i].metadata?.['stepId'] as string | undefined;
      if (stepId) return isAgent && stepId === 'model' && nodes[i].label ? `model#${nodes[i].label}` : stepId;
    }
    return null;
  }, [executionGraph, isAgent]);

  // Event id → step id, for naming a clicked span's step back on the rail.
  const stepOfEvent = useMemo(() => {
    const map = new Map<string, string>();
    for (const [stepId, exec] of Object.entries(instanceGraph?.steps ?? {})) {
      for (const id of exec.eventIds ?? []) map.set(id, stepId);
    }
    if (isAgent) {
      // Model events name the split row; signals name their event node.
      for (const n of executionGraph?.nodes ?? []) {
        if ((n.metadata?.['stepId'] as string | undefined) === 'model' && n.label) map.set(n.id, `model#${n.label}`);
      }
      for (const e of events) {
        if ((e['eventType'] ?? '') !== 'WORKFLOW_EXECUTION_SIGNALED') continue;
        const name = (e['attributes'] as Record<string, unknown> | undefined)?.['signalName'];
        const id = e['eventId'];
        if (typeof name === 'string' && (typeof id === 'string' || typeof id === 'number')) map.set(String(id), `event:${name}`);
      }
    }
    return map;
  }, [instanceGraph, isAgent, executionGraph, events]);

  const stepEventIds = useMemo(() => {
    return (stepId: string): Set<string> => {
      if (stepId.startsWith('model#')) {
        const activity = stepId.slice('model#'.length);
        return new Set((executionGraph?.nodes ?? []).filter((n) => (n.metadata?.['stepId'] as string | undefined) === 'model' && n.label === activity).map((n) => n.id));
      }
      if (stepId.startsWith('event:')) {
        return signalEventIds(events, stepId.slice('event:'.length));
      }
      return new Set(instanceGraph?.steps?.[stepId]?.eventIds ?? []);
    };
  }, [instanceGraph, executionGraph, events]);

  const visibleIds = useMemo(() => (selectedStepId && instanceGraph ? stepEventIds(selectedStepId) : null), [selectedStepId, instanceGraph, stepEventIds]);

  const selectSpan = (span: TimelineSpan | null) => {
    setSelectedSpan(span);
    setRailHighlight(span?.eventId ? (stepOfEvent.get(span.eventId) ?? null) : null);
  };

  // A rail click filters the timeline AND opens the clicked step's details — always, not only
  // when the overlay happened to be open. The FIRST matching span is selected deliberately: one
  // step can execute several times (retries, resets, loops), and the timeline is chronological,
  // so the first span is the step's first run — a stable answer to an ambiguous click, with the
  // rest one row away in the already-filtered lane.
  const selectStep = (stepId: string | null) => {
    setSelectedStepId(stepId);
    if (stepId) {
      const ids = stepEventIds(stepId);
      setSelectedSpan(timeline.spans.find((sp) => ids.has(sp.eventId ?? sp.key)) ?? null);
    }
  };

  // The details ride in an overlay pinned to the pane's right edge, so opening one never reflows
  // the lanes — clicking down the timeline keeps every row exactly where it was.
  const spanDetail = useMemo(() => {
    if (!selectedSpan) return null;
    const node = { id: selectedSpan.eventId ?? selectedSpan.key, label: selectedSpan.label, type: selectedSpan.category, status: selectedSpan.status };
    return { node, detail: extractNodeExecutionDetail(node, events) };
  }, [selectedSpan, events]);

  const timelinePane: ReactNode = (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <WorkflowTimeline events={events} graph={executionGraph} visibleIds={visibleIds} selectedKey={selectedSpan ? (selectedSpan.eventId ?? selectedSpan.key) : null} onSelectSpan={selectSpan} />
    </Box>
  );

  // The instances payload reports result: null even for completed runs; the history knows better.
  const resultRaw = info && info['result'] != null ? jsonPretty(info['result']) : workflowResult;
  const completedNoResult = (info?.status ?? '').toUpperCase() === 'COMPLETED' && resultRaw == null;
  const cards = (
    <Stack gap={1.5}>
      {info && <ExecutionSummary info={info} fallbackStartMs={historyRange?.start} fallbackEndMs={historyRange?.end} onOpenHistory={onOpenHistory} />}
      <Stack direction="row" gap={1.5} sx={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {startInput !== null && (
          <Box sx={{ flex: 1, minWidth: 280 }}>
            <StructuredValue title="Workflow input" raw={startInput} environmentId={environmentId} />
          </Box>
        )}
        {resultRaw != null ? (
          <Box sx={{ flex: 1, minWidth: 280 }}>
            <StructuredValue title="Workflow result" raw={resultRaw} environmentId={environmentId} />
          </Box>
        ) : completedNoResult ? (
          <Box sx={{ flex: 1, minWidth: 280, alignSelf: 'center' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Completed with no return value.
            </Typography>
          </Box>
        ) : null}
      </Stack>
    </Stack>
  );

  const selectedCount = visibleIds?.size ?? 0;
  const railDisabled = reason != null || !instanceGraph;

  return (
    <Stack gap={1.5}>
      {cards}
      <Stack direction="row" alignItems="center" gap={1.5} sx={{ flexWrap: 'wrap' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {isAgent ? 'The agent as declared. Reference only.' : 'Approximation of execution flow using checkpoints. Reference only.'}
        </Typography>
        {selectedStepId && <Chip size="small" color="primary" variant="outlined" label={`Filtered: ${selectedStepId} · ${selectedCount} ${selectedCount === 1 ? 'execution' : 'executions'}`} onDelete={() => setSelectedStepId(null)} />}
      </Stack>

      <Stack ref={splitRef} direction={{ xs: 'column', md: 'row' }} gap={{ xs: 2, md: 0 }} alignItems="stretch" sx={{ position: 'relative' }}>
        <Box sx={{ position: 'relative', width: { xs: '100%', md: `${railPct}%` }, minWidth: { md: 220 }, flexShrink: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'action.hover', maxHeight: '62vh', overflow: 'hidden' }}>
          {railDisabled ? (
            <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', p: 2, minHeight: 160 }}>
              <Typography variant="caption" sx={{ color: 'text.disabled', textAlign: 'center' }}>
                No flow details available.
                <br />
                {reason ?? 'The workflow structure could not be loaded.'}
              </Typography>
            </Stack>
          ) : (
            <>
              <Tooltip title={railVariant === 'chart' ? (isAgent ? 'Show as the agent map' : 'Show as a UML activity diagram') : 'Show as a compact list'}>
                <IconButton
                  size="small"
                  aria-label="toggle flow style"
                  onClick={() => setRailVariant((v) => (v === 'chart' ? 'uml' : 'chart'))}
                  sx={{ position: 'absolute', top: 4, right: 4, zIndex: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', '&:hover': { bgcolor: 'background.paper' } }}>
                  {railVariant === 'chart' ? <GitBranch size={14} /> : <List size={14} />}
                </IconButton>
              </Tooltip>
              {isAgent ? (
                railVariant === 'chart' ? (
                  <AgentRail data={instanceGraph!} executionGraph={executionGraph} events={events} selectedStepId={selectedStepId ?? railHighlight} onSelect={selectStep} />
                ) : (
                  <AgentStarRail data={instanceGraph!} selectedStepId={(selectedStepId ?? railHighlight)?.startsWith('model#') ? 'model' : (selectedStepId ?? railHighlight)} onSelect={selectStep} />
                )
              ) : (
                <FlowRail data={instanceGraph!} selectedStepId={selectedStepId ?? railHighlight} currentStepId={currentStepId} onSelect={selectStep} variant={railVariant} />
              )}
            </>
          )}
        </Box>
        <Box
          role="separator"
          aria-orientation="vertical"
          aria-label="resize the flow pane"
          onPointerDown={startResize}
          sx={{ display: { xs: 'none', md: 'flex' }, width: 14, cursor: 'col-resize', alignItems: 'center', justifyContent: 'center', flexShrink: 0, '&:hover > div': { bgcolor: 'primary.main' } }}>
          <Box sx={{ width: 3, height: 44, borderRadius: 1.5, bgcolor: 'divider', transition: 'background-color 0.15s' }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex' }}>{timelinePane}</Box>
        {/* The details ride over the whole split, not over the timeline alone: a short timeline
            would otherwise crop them. Rows never reflow either way. */}
        {spanDetail && (
          <Box sx={{ position: 'absolute', top: 0, right: 0, width: { xs: '100%', sm: 'min(440px, 85%)' }, maxHeight: '62vh', minHeight: 220, overflow: 'auto', boxShadow: 8, zIndex: 2, display: 'flex', borderRadius: 1 }}>
            <NodeDetailPanel node={spanDetail.node} detail={spanDetail.detail} hasHistory={events.length > 0} onClose={() => selectSpan(null)} fullWidth environmentId={environmentId} />
          </Box>
        )}
      </Stack>
    </Stack>
  );
}
