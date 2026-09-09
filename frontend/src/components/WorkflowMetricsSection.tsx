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

import { Card, CardContent, Grid, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@wso2/oxygen-ui';
import { LineChart } from '@wso2/oxygen-ui-charts-react';
import { useMemo, type JSX } from 'react';
import { useWorkflowMetrics, type MetricsRequest, type WorkflowMetricEntry } from '../api/metrics';

/**
 * Workflow metrics for the metrics page: what the runtime's workflows did in the window —
 * runs started, completed and failed with their durations, activity attempts and failures by
 * activity, and task decisions by task. Fed by the workflow module's samples through
 * `/icp/observability/workflow-metrics`; renders nothing for an integration that has none, so
 * a plain HTTP integration's page is unchanged.
 */

interface WorkflowMetricsSectionProps {
  request: MetricsRequest | null;
  getTimeRange: () => { startTime: string; endTime: string };
  /** Formats a bucket's ISO timestamp for the x axis, the way the page's other charts do. */
  makeLabel: (iso: string) => string;
}

const LINE_OPTS = { dot: false, connectNulls: true, type: 'linear' as const };
const RUN_LINES = [
  { dataKey: 'started', name: 'Started', stroke: '#2196f3' },
  { dataKey: 'completed', name: 'Completed', stroke: '#4caf50' },
  { dataKey: 'failed', name: 'Failed', stroke: '#d32f2f' },
] as const;

function sum(ts: Record<string, number>): number {
  return Object.values(ts).reduce((a, b) => a + b, 0);
}

/** Adds one series' per-interval counts into `into`, keyed by timestamp. */
function addInto(into: Record<string, number>, ts: Record<string, number>): void {
  for (const [k, v] of Object.entries(ts)) into[k] = (into[k] ?? 0) + v;
}

/** The latest interval that has a value, so a duration card reads the most recent number, not zero. */
function latestNonZero(ts: Record<string, number>): number {
  const keys = Object.keys(ts).sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    if (ts[keys[i]] > 0) return ts[keys[i]];
  }
  return 0;
}

interface ActivityRow {
  activity: string;
  attempts: number;
  failures: number;
  avgMs: number;
}

interface DecisionRow {
  task: string;
  kind: string;
  accepted: number;
  denied: number;
}

function aggregateRuns(runs: WorkflowMetricEntry[]) {
  const started: Record<string, number> = {};
  const completed: Record<string, number> = {};
  const failed: Record<string, number> = {};
  let latestP95 = 0;
  for (const r of runs) {
    if (r.sample === 'workflow.started') addInto(started, r.count.timeSeriesData);
    if (r.sample === 'workflow.closed') {
      addInto(r.tags.status === 'failed' ? failed : completed, r.count.timeSeriesData);
      latestP95 = Math.max(latestP95, latestNonZero(r.duration_seconds_percentile_95.timeSeriesData));
    }
  }
  const timestamps = Array.from(new Set([...Object.keys(started), ...Object.keys(completed), ...Object.keys(failed)])).sort();
  const chart = timestamps.map((ts) => ({ ts, started: started[ts] ?? 0, completed: completed[ts] ?? 0, failed: failed[ts] ?? 0 }));
  const totalStarted = sum(started);
  const totalCompleted = sum(completed);
  const totalFailed = sum(failed);
  const closed = totalCompleted + totalFailed;
  return { chart, totalStarted, totalCompleted, totalFailed, failurePct: closed > 0 ? (totalFailed / closed) * 100 : 0, latestP95 };
}

function aggregateActivities(activities: WorkflowMetricEntry[]): ActivityRow[] {
  const rows: Record<string, ActivityRow & { durationWeighted: number }> = {};
  for (const a of activities) {
    const key = a.tags.activity_type ?? 'unknown';
    const row = (rows[key] ??= { activity: key, attempts: 0, failures: 0, avgMs: 0, durationWeighted: 0 });
    const n = sum(a.count.timeSeriesData);
    row.attempts += n;
    if (a.tags.outcome === 'failed') row.failures += n;
    // Weight each interval's mean by its count so the row's mean is the true mean.
    for (const [ts, c] of Object.entries(a.count.timeSeriesData)) {
      row.durationWeighted += (a.duration_seconds_avg.timeSeriesData[ts] ?? 0) * c;
    }
  }
  return Object.values(rows)
    .map((r) => ({ activity: r.activity, attempts: r.attempts, failures: r.failures, avgMs: r.attempts > 0 ? (r.durationWeighted / r.attempts) * 1000 : 0 }))
    .sort((x, y) => y.failures - x.failures || y.attempts - x.attempts);
}

function aggregateDecisions(decisions: WorkflowMetricEntry[]): DecisionRow[] {
  const rows: Record<string, DecisionRow> = {};
  for (const d of decisions) {
    const key = d.tags.task_name ?? 'unknown';
    const row = (rows[key] ??= { task: key, kind: d.tags.task_kind ?? '', accepted: 0, denied: 0 });
    const n = sum(d.count.timeSeriesData);
    if (d.tags.outcome === 'denied') row.denied += n;
    else row.accepted += n;
  }
  return Object.values(rows).sort((x, y) => y.accepted + y.denied - (x.accepted + x.denied));
}

function StatCard({ title, value, color }: { title: string; value: string; color?: string }): JSX.Element {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          {title}
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 700, mt: 1, color }}>
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}

export default function WorkflowMetricsSection({ request, getTimeRange, makeLabel }: WorkflowMetricsSectionProps): JSX.Element | null {
  const { data } = useWorkflowMetrics(request, getTimeRange);

  const runs = useMemo(() => aggregateRuns(data?.runs ?? []), [data]);
  const activities = useMemo(() => aggregateActivities(data?.activities ?? []), [data]);
  const decisions = useMemo(() => aggregateDecisions(data?.decisions ?? []), [data]);
  const runChart = useMemo(() => runs.chart.map((p) => ({ ...p, label: makeLabel(p.ts) })), [runs.chart, makeLabel]);

  const hasAnything = (data?.runs.length ?? 0) + (data?.activities.length ?? 0) + (data?.decisions.length ?? 0) + (data?.dataEvents.length ?? 0) > 0;
  // A failed or absent workflow-metrics call must never take the HTTP metrics down with it: say nothing.
  if (!data || !hasAnything) return null;

  const xAxisInterval = Math.max(0, Math.floor(runChart.length / 8) - 1);

  return (
    <>
      <Typography variant="h5" sx={{ mt: 2, mb: 2 }}>
        Workflows
      </Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="Runs Started" value={runs.totalStarted.toLocaleString()} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="Runs Completed" value={runs.totalCompleted.toLocaleString()} color="success.main" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="Runs Failed" value={`${runs.totalFailed.toLocaleString()} (${runs.failurePct.toFixed(1)}%)`} color="error.main" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="Run Duration P95 (Latest)" value={`${runs.latestP95.toFixed(1)} s`} />
        </Grid>
      </Grid>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Runs Per Interval
              </Typography>
              <LineChart
                data={runChart}
                xAxisDataKey="label"
                height={300}
                legend={{ show: true }}
                grid={{ show: true, strokeDasharray: '3 3' }}
                xAxis={{ interval: xAxisInterval }}
                margin={{ bottom: 20 }}
                lines={RUN_LINES.map((l) => ({ ...l, ...LINE_OPTS }))}
              />
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Activities
              </Typography>
              {activities.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No activity attempts in this window.
                </Typography>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Activity</TableCell>
                        <TableCell align="right">Attempts</TableCell>
                        <TableCell align="right">Failures</TableCell>
                        <TableCell align="right">Avg (ms)</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {activities.map((row) => (
                        <TableRow key={row.activity}>
                          <TableCell>{row.activity}</TableCell>
                          <TableCell align="right">{row.attempts.toLocaleString()}</TableCell>
                          <TableCell align="right" sx={{ color: row.failures > 0 ? 'error.main' : undefined }}>
                            {row.failures.toLocaleString()}
                          </TableCell>
                          <TableCell align="right">{row.avgMs.toFixed(0)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {decisions.length > 0 && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  Human Decisions
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Task</TableCell>
                        <TableCell>Kind</TableCell>
                        <TableCell align="right">Accepted</TableCell>
                        <TableCell align="right">Denied</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {decisions.map((row) => (
                        <TableRow key={row.task}>
                          <TableCell>{row.task}</TableCell>
                          <TableCell>{row.kind === 'REVIEW_ACTIVITY' ? 'Review' : 'Human task'}</TableCell>
                          <TableCell align="right">{row.accepted.toLocaleString()}</TableCell>
                          <TableCell align="right" sx={{ color: row.denied > 0 ? 'error.main' : undefined }}>
                            {row.denied.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
      <Stack />
    </>
  );
}
