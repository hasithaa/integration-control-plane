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
import AgentStarRail from './AgentStarRail';
import ExecutionSummary from './ExecutionSummary';
import FlowRail from './FlowRail';
import NodeDetailPanel from './NodeDetailPanel';
import WorkflowTimeline from './WorkflowTimeline';
import { buildTimeline, extractNodeExecutionDetail, extractWorkflowInput, flowUnavailable, type TimelineSpan } from './helpers';

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
 */

/** Event ids produced by one star node, matched by what each history node names. */
function agentEventIds(stepId: string, executionGraph: ExecutionGraphData | undefined, events: Array<Record<string, unknown>>): Set<string> {
  const ids = new Set<string>();
  if (!executionGraph) return ids;
  const name = stepId.replace(/^(tool|event|task):/, '');
  for (const node of executionGraph.nodes ?? []) {
    const label = (node.label ?? '').toLowerCase();
    const type = (node.type ?? '').toUpperCase();
    let matches = false;
    if (stepId === 'model') {
      matches = ['llmchat', 'generateresult', 'generate'].some((n) => label.endsWith(n));
    } else if (stepId.startsWith('tool:')) {
      // A tool backed by an activity runs under its own name; an AI tool runs inside the
      // executeAgentTool activity and is named in its input.
      matches = label === name.toLowerCase();
      if (!matches && label.endsWith('executeagenttool')) {
        const input = extractNodeExecutionDetail(node, events).input ?? '';
        matches = input.includes(name);
      }
    } else if (stepId.startsWith('task:')) {
      matches = type === 'HUMAN_TASK' && label.includes(name.toLowerCase());
    } else if (stepId.startsWith('event:')) {
      const input = extractNodeExecutionDetail(node, events).input ?? '';
      matches = (type === 'SIGNAL' || type === 'DATA' || label.includes('event')) && input.includes(name);
    }
    if (matches) {
      ids.add(node.id);
    }
  }
  return ids;
}

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
  // The instances payload carries no times; the history does.
  const historyRange = useMemo(() => {
    const built = buildTimeline(events);
    return built.spans.length > 0 ? { start: built.start, end: built.end } : null;
  }, [events]);
  // The run's real result: the instances payload reports null, the terminal event does not.
  const workflowResult = useMemo(() => extractNodeExecutionDetail({ id: '', type: 'WORKFLOW' }, events).result, [events]);

  // The last executed step, for the rail's "you are here" mark. Approximate by nature.
  const currentStepId = useMemo(() => {
    if (!executionGraph) return null;
    const nodes = executionGraph.nodes ?? [];
    for (let i = nodes.length - 1; i >= 0; i--) {
      const stepId = nodes[i].metadata?.['stepId'] as string | undefined;
      if (stepId) return stepId;
    }
    return null;
  }, [executionGraph]);

  // Event id → step id, for naming a clicked span's step back on the rail.
  const stepOfEvent = useMemo(() => {
    const map = new Map<string, string>();
    for (const [stepId, exec] of Object.entries(instanceGraph?.steps ?? {})) {
      for (const id of exec.eventIds ?? []) map.set(id, stepId);
    }
    return map;
  }, [instanceGraph]);

  const visibleIds = useMemo(() => {
    if (!selectedStepId || !instanceGraph) return null;
    if (isAgent) return agentEventIds(selectedStepId, executionGraph, events);
    return new Set(instanceGraph.steps?.[selectedStepId]?.eventIds ?? []);
  }, [selectedStepId, instanceGraph, isAgent, executionGraph, events]);

  const selectSpan = (span: TimelineSpan | null) => {
    setSelectedSpan(span);
    setRailHighlight(span?.eventId ? (stepOfEvent.get(span.eventId) ?? null) : null);
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

  const cards = (
    <Stack direction="row" gap={1.5} sx={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {startInput !== null && (
        <Box sx={{ flex: 1, minWidth: 280 }}>
          <StructuredValue title="Workflow input" raw={startInput} environmentId={environmentId} />
        </Box>
      )}
      {info && (
        <Box sx={{ flex: 1, minWidth: 280 }}>
          <ExecutionSummary info={info} fallbackStartMs={historyRange?.start} fallbackEndMs={historyRange?.end} onOpenHistory={onOpenHistory} fallbackResult={workflowResult} />
        </Box>
      )}
    </Stack>
  );

  const selectedCount = visibleIds?.size ?? 0;
  const railDisabled = reason != null || !instanceGraph;

  return (
    <Stack gap={1.5}>
      {cards}
      <Stack direction="row" alignItems="center" gap={1.5} sx={{ flexWrap: 'wrap' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {isAgent ? 'The agent as declared. Reference only.' : 'Approximation of execution flow. Reference only.'}
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
              {!isAgent && (
                <Tooltip title={railVariant === 'chart' ? 'Show as a UML activity diagram' : 'Show as a compact chart'}>
                  <IconButton
                    size="small"
                    aria-label="toggle flow style"
                    onClick={() => setRailVariant((v) => (v === 'chart' ? 'uml' : 'chart'))}
                    sx={{ position: 'absolute', top: 4, right: 4, zIndex: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', '&:hover': { bgcolor: 'background.paper' } }}>
                    {railVariant === 'chart' ? <GitBranch size={14} /> : <List size={14} />}
                  </IconButton>
                </Tooltip>
              )}
              {isAgent ? (
                <AgentStarRail data={instanceGraph!} selectedStepId={selectedStepId} onSelect={setSelectedStepId} />
              ) : (
                <FlowRail data={instanceGraph!} selectedStepId={selectedStepId ?? railHighlight} currentStepId={currentStepId} onSelect={setSelectedStepId} variant={railVariant} />
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
