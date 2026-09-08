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

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  instanceCountQueryOptions,
  pendingReviewCountQueryOptions,
  pendingTaskCountQueryOptions,
  totalPendingTaskCountQueryOptions,
  valueOf,
  type CappedCount,
  type PendingReviewCount,
} from '../../api/workflows';

/**
 * The numbers that say how one integration's workflows are doing, and the pieces that show them.
 * Shared by the project-level tables (one row per integration) and the integration overview's
 * strip (IntegrationStatsStrip), so the two places read the same figures from the same queries —
 * react-query dedupes by key, so a person moving between them pays for each count once.
 *
 * Every figure is one bounded request to the integration's runtime, through the tunnel. An
 * integration whose runtime is not heartbeating answers nothing: its figures settle to "—" and
 * its neighbours' are unaffected. That isolation is the point — a project view must degrade one
 * cell at a time, never as a whole, when one of several integrations is missing.
 */

interface StatsScope {
  componentId: string;
  environmentId: string;
}

/** One integration's numbers. `undefined` is still loading; a metric that failed to load is `null`. */
export interface IntegrationStats {
  running?: CappedCount | null;
  suspended?: CappedCount | null;
  failed?: CappedCount | null;
  completed?: CappedCount | null;
  reviews?: PendingReviewCount | null;
  /** Pending human tasks for anyone in any role — the integration's total. */
  tasks?: number | null;
  /** Pending human tasks the caller's roles can act on — their slice. */
  myTasks?: number | null;
}

/** Which figures a view actually shows; the others are not requested. */
export interface StatsSelection {
  instances: boolean;
  reviews: boolean;
  tasks: boolean;
  myTasks: boolean;
}

/**
 * The "last 24 hours" window for the finished-instance counts, fixed once per mount: it is part
 * of every count's query key, and a value that moved every render would refetch in a loop. A
 * page reload starts a fresh window.
 */
export function useSinceWindow(): string {
  return useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), []);
}

/**
 * The selected figures for each scope, fanned out with one batch per metric. The result is
 * aligned with `scopes`. The runtime scopes every listing to the integration's own task queue on
 * the server, so no queue needs naming here.
 */
export function useIntegrationStats(scopes: StatsScope[], since: string, include: StatsSelection): IntegrationStats[] {
  const running = useQueries({ queries: scopes.map((s) => ({ ...instanceCountQueryOptions(s, { status: 'RUNNING' }), enabled: include.instances })) });
  const suspended = useQueries({ queries: scopes.map((s) => ({ ...instanceCountQueryOptions(s, { status: 'SUSPENDED' }), enabled: include.instances })) });
  const failed = useQueries({ queries: scopes.map((s) => ({ ...instanceCountQueryOptions(s, { status: 'FAILED', closeTimeFrom: since }), enabled: include.instances })) });
  const completed = useQueries({ queries: scopes.map((s) => ({ ...instanceCountQueryOptions(s, { status: 'COMPLETED', closeTimeFrom: since }), enabled: include.instances })) });
  const reviews = useQueries({ queries: scopes.map((s) => ({ ...pendingReviewCountQueryOptions(s), enabled: include.reviews })) });
  const tasks = useQueries({ queries: scopes.map((s) => ({ ...totalPendingTaskCountQueryOptions(s), enabled: include.tasks })) });
  const myTasks = useQueries({ queries: scopes.map((s) => ({ ...pendingTaskCountQueryOptions(s), enabled: include.myTasks })) });

  // A metric that errored reads as null — shown as "—" — rather than spinning forever as "…".
  const settle = <T,>(r: { data?: unknown; error: unknown } | undefined): T | null | undefined => {
    if (!r) return undefined;
    if (r.error) return null;
    return valueOf(r.data as Parameters<typeof valueOf>[0]) as T | undefined;
  };
  return scopes.map((_, i) => ({
    running: settle<CappedCount>(running[i]),
    suspended: settle<CappedCount>(suspended[i]),
    failed: settle<CappedCount>(failed[i]),
    completed: settle<CappedCount>(completed[i]),
    reviews: settle<PendingReviewCount>(reviews[i]),
    tasks: settle<number>(tasks[i]),
    myTasks: settle<number>(myTasks[i]),
  }));
}

/** A capped count as text: exact below the page size, "50+" at it, "…" while loading, "—" when unavailable. */
export const countText = (c: CappedCount | PendingReviewCount | null | undefined): string => (c === undefined ? '…' : c === null ? '—' : `${c.count}${c.capped ? '+' : ''}`);
export const numberText = (n: number | null | undefined): string => (n === undefined ? '…' : n === null ? '—' : String(n));

/** Sums one capped metric across rows; pending while any row is, capped when any row was. */
export function totalOf(rows: IntegrationStats[], pick: (s: IntegrationStats) => CappedCount | PendingReviewCount | null | undefined): { text: string; count: number } {
  let count = 0;
  let capped = false;
  let pending = false;
  for (const row of rows) {
    const v = pick(row);
    if (v === undefined) pending = true;
    else if (v) {
      count += v.count;
      capped = capped || v.capped;
    }
  }
  return { text: pending ? '…' : `${count}${capped ? '+' : ''}`, count };
}

/** Sums a plain-number metric across rows; pending while any row is. */
export function sumOf(rows: IntegrationStats[], pick: (s: IntegrationStats) => number | null | undefined): { text: string; count: number } {
  let count = 0;
  let pending = false;
  for (const row of rows) {
    const v = pick(row);
    if (v === undefined) pending = true;
    else if (typeof v === 'number') count += v;
  }
  return { text: pending ? '…' : String(count), count };
}
