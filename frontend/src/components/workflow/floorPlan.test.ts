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

import { describe, expect, it } from 'vitest';
import type { ModelGraph, StepReview } from '../../api/workflows';
import { layoutFloorPlan, sequenceNodes } from './floorPlan';
import { reviewToOpen, stepText } from './helpers';

// A gated activity inside a do block, its review, and the step after it — the shape the compiler emits.
const GRAPH: ModelGraph = {
  nodes: [
    { stepId: 'do#1', kind: 'TRY' },
    { stepId: 'chargeCard#1', kind: 'ACTIVITY', target: 'chargeCard', parent: 'do#1', branch: 'do' },
    { stepId: 'chargeCard#1#review', kind: 'REVIEW', target: 'chargeCard', parent: 'do#1', branch: 'do' },
    { stepId: 'shipOrder#1', kind: 'ACTIVITY', target: 'shipOrder', parent: 'do#1', branch: 'do' },
  ],
  edges: [
    { from: 'do#1', to: 'chargeCard#1', when: 'do' },
    { from: 'chargeCard#1', to: 'shipOrder#1' },
    { from: 'chargeCard#1', to: 'chargeCard#1#review', when: 'on failure' },
  ],
};

describe('sequenceNodes', () => {
  it('leaves a review out of the sequence, so its activity is not drawn twice', () => {
    expect(sequenceNodes(GRAPH).map((n) => n.stepId)).toEqual(['do#1', 'chargeCard#1', 'shipOrder#1']);
  });

  it('leaves out any node reached only by a side edge, whatever its kind', () => {
    const graph: ModelGraph = {
      nodes: [
        { stepId: 'a#1', kind: 'ACTIVITY', target: 'a' },
        { stepId: 'gate#1', kind: 'APPROVAL', target: 'a' },
      ],
      edges: [{ from: 'gate#1', to: 'a#1', when: 'before run' }, { from: 'a#1', to: 'gate#1', when: 'before run' }],
    };
    expect(sequenceNodes(graph).map((n) => n.stepId)).toEqual([]);
  });
});

describe('layoutFloorPlan', () => {
  it('places only the activities in the do arm, one box each', () => {
    const plan = layoutFloorPlan(GRAPH);
    expect(plan.nodes).toHaveLength(1);
    expect(plan.nodes[0].arms[0].children.map((c) => c.node.stepId)).toEqual(['chargeCard#1', 'shipOrder#1']);
  });
});

describe('stepText', () => {
  it('shows the display name over the called function', () => {
    expect(stepText({ stepId: 'chargeCard#1', kind: 'ACTIVITY', target: 'chargeCard', label: 'Charge card' })).toBe('Charge card');
    expect(stepText({ stepId: 'chargeCard#1', kind: 'ACTIVITY', target: 'chargeCard' })).toBe('chargeCard');
  });

  it('reads a step that calls nothing as what it does, not its id', () => {
    expect(stepText({ stepId: 'sleep#1', kind: 'SLEEP' })).toBe('sleep');
    expect(stepText({ stepId: 'wait#1', kind: 'EVENT_WAIT', target: 'approved|rejected' })).toBe('wait approved | rejected');
    expect(stepText({ stepId: 'awaitResult#1', kind: 'AWAIT_RESULT' })).toBe('await result');
  });
});

describe('reviewToOpen', () => {
  const decided: StepReview = { taskId: 'review-1', status: 'COMPLETED' };
  const pending: StepReview = { taskId: 'review-2', status: 'RUNNING' };

  it('opens the pending review, since that is what someone has to act on', () => {
    expect(reviewToOpen([decided, pending, { taskId: 'review-3', status: 'COMPLETED' }])).toBe(pending);
  });

  it('opens the latest review when every one is decided', () => {
    const latest: StepReview = { taskId: 'review-3', status: 'COMPLETED' };
    expect(reviewToOpen([decided, latest])).toBe(latest);
  });

  it('opens nothing when no review carries a task id', () => {
    expect(reviewToOpen([{ status: 'RUNNING' }])).toBeUndefined();
  });
});
