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

import { Box, Tooltip, Typography } from '@wso2/oxygen-ui';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { resourceUrl, type ComponentScope } from '../../nav';
import { countText, numberText, useIntegrationStats, useSinceWindow } from './WorkflowStats';

interface StripCell {
  label: string;
  value: string;
  help: string;
  /** Where the number leads — the page that lists what it counts. */
  to: string;
  alarm?: boolean;
}

/**
 * The same figures the project's Workflow Executions table shows for this integration, on the
 * integration's own overview: what is running, what finished how in the last day, what is waiting
 * on a person. Laid out like the definition's State / Worker Count cells above it, and each number
 * opens the page that lists what it counts.
 *
 * Integration-wide by design: the runtime scopes every count to the integration's task queue, and
 * the pending-work counts have no per-definition form, so the strip reads across every workflow
 * type the integration runs rather than mixing two scopes in one row.
 */
export function IntegrationStatsStrip({ scope, componentId, environmentId, canSeeWork }: { scope: ComponentScope; componentId: string; environmentId: string; canSeeWork: boolean }): JSX.Element {
  const navigate = useNavigate();
  const since = useSinceWindow();
  const [s] = useIntegrationStats([{ componentId, environmentId }], since, { instances: true, reviews: canSeeWork, tasks: canSeeWork, myTasks: false });
  const env = `env=${encodeURIComponent(environmentId)}`;
  const executions = `${resourceUrl(scope, 'workflows')}?${env}`;
  const cells: StripCell[] = [
    { label: 'Running', value: countText(s?.running), help: 'Instances currently executing or parked. Opens the executions list.', to: executions },
    { label: 'Suspended', value: countText(s?.suspended), help: 'Instances paused by an operator, waiting to be resumed.', to: executions },
    { label: 'Failed (24h)', value: countText(s?.failed), help: 'Instances that finished as FAILED in the last 24 hours.', to: executions, alarm: (s?.failed?.count ?? 0) > 0 },
    { label: 'Completed (24h)', value: countText(s?.completed), help: 'Instances that finished successfully in the last 24 hours.', to: executions },
  ];
  if (canSeeWork) {
    cells.push(
      { label: 'Pending Reviews', value: countText(s?.reviews), help: 'Review activities waiting for a decision — approval gates and failed-activity reviews. Opens Human Tasks.', to: `${resourceUrl(scope, 'tasks')}?tab=reviews&${env}` },
      { label: 'Pending Tasks', value: numberText(s?.tasks), help: 'Human tasks waiting for anyone in any role — the integration total. Human Tasks shows the ones you can act on.', to: `${resourceUrl(scope, 'tasks')}?${env}` },
    );
  }

  return (
    <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, pt: 1.5 }}>
        Across every workflow type this integration runs in this environment. A "+" means more than the first page; open a number for the list behind it.
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${cells.length}, 1fr)` }}>
        {cells.map((c, i) => (
          <Tooltip key={c.label} title={c.help}>
            <Box
              role="link"
              tabIndex={0}
              onClick={() => navigate(c.to)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') navigate(c.to);
              }}
              sx={{
                px: 2,
                py: 1.5,
                cursor: 'pointer',
                outline: 'none',
                '&:hover, &:focus-visible': { bgcolor: 'action.hover' },
                ...(i < cells.length - 1 && { borderRight: '1px solid', borderColor: 'divider' }),
              }}>
              <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10, fontWeight: 600, display: 'block' }}>
                {c.label.toUpperCase()}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', mt: 0.5, fontVariantNumeric: 'tabular-nums', color: c.alarm ? 'error.main' : 'inherit', fontWeight: c.alarm ? 600 : 400 }}>
                {c.value}
              </Typography>
            </Box>
          </Tooltip>
        ))}
      </Box>
    </Box>
  );
}
