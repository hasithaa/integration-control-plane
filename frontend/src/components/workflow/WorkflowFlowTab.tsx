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
import { List, Workflow } from '@wso2/oxygen-ui-icons-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { ExecutionGraph as ExecutionGraphData, InstanceGraph } from '../../api/workflows';
import AgentStarRail from './AgentStarRail';
import ExecutionGraph from './ExecutionGraph';
import FlowRail from './FlowRail';
import { extractNodeExecutionDetail, flowUnavailable } from './helpers';

/**
 * The flow view: the program's static map beside the run's chronological truth.
 *
 *   [ flow / agent rail ] [ execution graph (+ its detail panel on node click) ]
 *
 * The rail is what the compiler described — control flow for a workflow, the star for an agent —
 * and deliberately embodies no runtime story beyond execution counts and dimming: every earlier
 * attempt to paint the run onto the model forced a guess somewhere (early returns, loop
 * iterations, retries), and a map that guesses is worse than a map that navigates. Clicking a rail
 * node filters the execution graph to that node's own history events, which handles repeated
 * executions by simply showing them all, in order. Clicking an execution node opens its details
 * and highlights its step back on the rail. Both panes scroll independently, and the execution
 * graph stands alone whenever the rail's model is unavailable.
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

export default function WorkflowFlowTab({ instanceGraph, executionGraph, events }: { instanceGraph: InstanceGraph | undefined; executionGraph: ExecutionGraphData | undefined; events: Array<Record<string, unknown>> }) {
  // The rail's selection is the filter; the execution graph's selection reports back into it.
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [railHighlight, setRailHighlight] = useState<string | null>(null);
  const [railVariant, setRailVariant] = useState<'list' | 'chart'>('chart');

  const isAgent = instanceGraph?.graphKind === 'agent';
  const reason = flowUnavailable(instanceGraph);

  // The last executed step, for the rail's "you are here" mark. Approximate by nature: it is the
  // last event that named a step, nothing more.
  const currentStepId = useMemo(() => {
    if (!executionGraph) return null;
    const nodes = executionGraph.nodes ?? [];
    for (let i = nodes.length - 1; i >= 0; i--) {
      const stepId = nodes[i].metadata?.['stepId'] as string | undefined;
      if (stepId) return stepId;
    }
    return null;
  }, [executionGraph]);

  const visibleIds = useMemo(() => {
    if (!selectedStepId || !instanceGraph) return null;
    if (isAgent) return agentEventIds(selectedStepId, executionGraph, events);
    const eventIds = instanceGraph.steps?.[selectedStepId]?.eventIds ?? [];
    return new Set(eventIds);
  }, [selectedStepId, instanceGraph, isAgent, executionGraph, events]);

  const history: ReactNode = executionGraph ? (
    <ExecutionGraph graph={executionGraph} events={events} visibleIds={visibleIds} onSelectedStepChange={setRailHighlight} />
  ) : (
    <Typography sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>No execution graph available.</Typography>
  );

  // No model to draw: the execution graph stands alone, full width, and says why.
  if (reason || !instanceGraph) {
    return (
      <>
        <Alert severity="info" sx={{ mb: 2 }}>
          {reason ?? 'The workflow structure could not be loaded.'}
        </Alert>
        {history}
      </>
    );
  }

  const selectedCount = visibleIds?.size ?? 0;

  return (
    <Stack gap={1}>
      <Stack direction="row" alignItems="center" gap={1.5} sx={{ flexWrap: 'wrap' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {isAgent ? 'The agent as declared. Click a node to filter its executions on the right.' : 'The workflow as written — an approximation of execution flow. Click a step to filter its executions on the right.'}
        </Typography>
        {selectedStepId && <Chip size="small" color="primary" variant="outlined" label={`Filtered: ${selectedStepId} · ${selectedCount} ${selectedCount === 1 ? 'execution' : 'executions'}`} onDelete={() => setSelectedStepId(null)} />}
        {!isAgent && (
          <Tooltip title={railVariant === 'list' ? 'Show as a compact flow chart' : 'Show as a list'}>
            <IconButton size="small" aria-label="toggle flow style" onClick={() => setRailVariant((v) => (v === 'list' ? 'chart' : 'list'))} sx={{ ml: 'auto' }}>
              {railVariant === 'list' ? <Workflow size={14} /> : <List size={14} />}
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} gap={2} alignItems="stretch">
        <Box sx={{ width: { xs: '100%', md: 300 }, flexShrink: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'action.hover', maxHeight: '62vh', overflow: 'hidden' }}>
          {isAgent ? (
            <AgentStarRail data={instanceGraph} selectedStepId={selectedStepId} onSelect={setSelectedStepId} />
          ) : (
            <FlowRail data={instanceGraph} selectedStepId={selectedStepId ?? railHighlight} currentStepId={currentStepId} onSelect={setSelectedStepId} variant={railVariant} />
          )}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, maxHeight: '62vh', overflow: 'auto' }}>{history}</Box>
      </Stack>
    </Stack>
  );
}
