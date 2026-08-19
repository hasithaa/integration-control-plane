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

import { Alert, Typography } from '@wso2/oxygen-ui';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { ExecutionGraph as ExecutionGraphData, InstanceGraph } from '../../api/workflows';
import { flowUnavailable } from './helpers';
import ExecutionGraph from './ExecutionGraph';
import WorkflowFloorChart from './WorkflowFloorChart';

/**
 * The flow view is an addition, not a replacement. It needs two things the history alone cannot
 * supply — the workflow's published structure, and step ids naming which call site each event came
 * from — and either can be missing for reasons that have nothing to do with this instance: an
 * integration built before descriptors were published, a read served by a sibling integration on an
 * older module, a descriptor this console cannot parse.
 *
 * Whenever that happens the run's own history is still perfectly good, so this falls back to drawing
 * it and says why, rather than showing an empty tab. The same applies to an outright render failure:
 * a bug in the layout must not cost the operator the view they had before it existed.
 */

interface BoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

/**
 * Catches a render failure in the flow view and shows the history instead.
 *
 * Deliberately local: the application's error boundary sends the whole console to an error page,
 * which is the right response to a broken route and the wrong one to a diagram that failed to draw.
 */
class FlowBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('The workflow flow view failed to render; falling back to the history graph.', error, info);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function WorkflowFlowTab({ instanceGraph, executionGraph, events }: { instanceGraph: InstanceGraph | undefined; executionGraph: ExecutionGraphData | undefined; events: Array<Record<string, unknown>> }) {
  const history = executionGraph ? <ExecutionGraph graph={executionGraph} events={events} /> : <Typography sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>No execution graph available.</Typography>;

  const reason = flowUnavailable(instanceGraph);
  if (reason) {
    return (
      <>
        <Alert severity="info" sx={{ mb: 2 }}>
          {reason}
        </Alert>
        {history}
      </>
    );
  }

  return (
    <FlowBoundary
      fallback={
        <>
          <Alert severity="warning" sx={{ mb: 2 }}>
            The flow view could not be drawn for this instance, so its history is shown instead.
          </Alert>
          {history}
        </>
      }>
      <WorkflowFloorChart data={instanceGraph!} events={events} />
    </FlowBoundary>
  );
}
