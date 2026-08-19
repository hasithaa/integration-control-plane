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

import { Alert, Box, Chip, IconButton, Stack, Tooltip, Typography } from '@wso2/oxygen-ui';
import { GitBranch, Clock, List, Workflow } from '@wso2/oxygen-ui-icons-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { ExecutionGraph as ExecutionGraphData, InstanceGraph, WorkflowInstance } from '../../api/workflows';
import CodeViewer from '../CodeViewer';
import AgentStarRail from './AgentStarRail';
import ExecutionGraph from './ExecutionGraph';
import ExecutionSummary from './ExecutionSummary';
import FlowRail from './FlowRail';
import NodeDetailPanel from './NodeDetailPanel';
import WorkflowTimeline from './WorkflowTimeline';
import { extractNodeExecutionDetail, extractWorkflowInput, flowUnavailable, type TimelineSpan } from './helpers';

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

export default function WorkflowFlowTab({ instanceGraph, executionGraph, events, info }: { instanceGraph: InstanceGraph | undefined; executionGraph: ExecutionGraphData | undefined; events: Array<Record<string, unknown>>; info: WorkflowInstance | undefined }) {
  // The rail's selection is the filter; the right pane's selection reports back into the rail.
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [railHighlight, setRailHighlight] = useState<string | null>(null);
  const [railVariant, setRailVariant] = useState<'list' | 'chart'>('chart');
  const [rightPane, setRightPane] = useState<'timeline' | 'graph'>('timeline');
  const [selectedSpan, setSelectedSpan] = useState<TimelineSpan | null>(null);

  const isAgent = instanceGraph?.graphKind === 'agent';
  const reason = flowUnavailable(instanceGraph);
  const startInput = extractWorkflowInput(events);

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
    setRailHighlight(span ? (stepOfEvent.get(span.key) ?? null) : null);
  };

  const spanDetail = useMemo(() => {
    if (!selectedSpan) return null;
    const node = { id: selectedSpan.key, label: selectedSpan.label, type: selectedSpan.category, status: selectedSpan.status };
    return { node, detail: extractNodeExecutionDetail(node, events) };
  }, [selectedSpan, events]);

  const timelinePane: ReactNode = (
    <Stack direction={{ xs: 'column', md: 'row' }} gap={2} alignItems="flex-start" sx={{ minWidth: 0, flex: 1 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <WorkflowTimeline events={events} graph={executionGraph} visibleIds={visibleIds} selectedKey={selectedSpan?.key ?? null} onSelectSpan={selectSpan} />
      </Box>
      {spanDetail && <NodeDetailPanel node={spanDetail.node} detail={spanDetail.detail} hasHistory={events.length > 0} onClose={() => selectSpan(null)} />}
    </Stack>
  );

  const graphPane: ReactNode = executionGraph ? (
    <Box sx={{ flex: 1, minWidth: 0, maxHeight: '62vh', overflow: 'auto' }}>
      <ExecutionGraph graph={executionGraph} events={events} visibleIds={visibleIds} onSelectedStepChange={setRailHighlight} />
    </Box>
  ) : (
    <Typography sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>No execution graph available.</Typography>
  );

  const cards = (
    <Stack direction="row" gap={1.5} sx={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {startInput !== null && (
        <Box sx={{ flex: 1, minWidth: 280 }}>
          <CodeViewer code={startInput} language="json" title="Start input" height="18vh" expandable showLineNumbers={false} />
        </Box>
      )}
      {info && (
        <Box sx={{ flex: 1, minWidth: 280 }}>
          <ExecutionSummary info={info} />
        </Box>
      )}
    </Stack>
  );

  // No model to draw: the run's own views stand alone, full width, and say why.
  if (reason || !instanceGraph) {
    return (
      <Stack gap={2}>
        {cards}
        <Alert severity="info">{reason ?? 'The workflow structure could not be loaded.'}</Alert>
        {rightPane === 'timeline' ? timelinePane : graphPane}
      </Stack>
    );
  }

  const selectedCount = visibleIds?.size ?? 0;

  return (
    <Stack gap={1.5}>
      {cards}
      <Stack direction="row" alignItems="center" gap={1.5} sx={{ flexWrap: 'wrap' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {isAgent ? 'The agent as declared. Click a node to filter the run on the right.' : 'The workflow as written — an approximation of execution flow. Click a step to filter the run on the right.'}
        </Typography>
        {selectedStepId && <Chip size="small" color="primary" variant="outlined" label={`Filtered: ${selectedStepId} · ${selectedCount} ${selectedCount === 1 ? 'execution' : 'executions'}`} onDelete={() => setSelectedStepId(null)} />}
        <Stack direction="row" alignItems="center" sx={{ ml: 'auto' }}>
          {!isAgent && (
            <Tooltip title={railVariant === 'list' ? 'Show the flow as a compact chart' : 'Show the flow as a list'}>
              <IconButton size="small" aria-label="toggle flow style" onClick={() => setRailVariant((v) => (v === 'list' ? 'chart' : 'list'))}>
                {railVariant === 'list' ? <Workflow size={14} /> : <List size={14} />}
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={rightPane === 'timeline' ? 'Show the execution graph' : 'Show the timeline'}>
            <IconButton size="small" aria-label="toggle right pane" onClick={() => setRightPane((v) => (v === 'timeline' ? 'graph' : 'timeline'))}>
              {rightPane === 'timeline' ? <GitBranch size={14} /> : <Clock size={14} />}
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} gap={2} alignItems="stretch">
        <Box sx={{ width: { xs: '100%', md: 320 }, flexShrink: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'action.hover', maxHeight: '62vh', overflow: 'hidden' }}>
          {isAgent ? (
            <AgentStarRail data={instanceGraph} selectedStepId={selectedStepId} onSelect={setSelectedStepId} />
          ) : (
            <FlowRail data={instanceGraph} selectedStepId={selectedStepId ?? railHighlight} currentStepId={currentStepId} onSelect={setSelectedStepId} variant={railVariant} />
          )}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex' }}>{rightPane === 'timeline' ? timelinePane : graphPane}</Box>
      </Stack>
    </Stack>
  );
}
