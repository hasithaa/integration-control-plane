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

/** Timestamps as `YYYY-MM-DD HH:mm:ss`, 24h, on one clock (local or UTC); no locale-dependent formatting. */

export type TimeZonePreference = 'local' | 'utc';

const STORAGE_KEY = 'icp_time_zone';
let current: TimeZonePreference = readStoredPreference();

function readStoredPreference(): TimeZonePreference {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'utc' ? 'utc' : 'local';
  } catch {
    return 'local';
  }
}

export function getTimeZonePreference(): TimeZonePreference {
  return current;
}

export function setTimeZonePreference(zone: TimeZonePreference): void {
  current = zone;
  try {
    localStorage.setItem(STORAGE_KEY, zone);
  } catch {
    // Storage unavailable: the choice does not survive the tab.
  }
}

/** The IANA name of the browser's zone, e.g. "Asia/Colombo"; empty when the browser does not say. */
export function localZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

/** The local zone's offset from UTC right now, as "UTC+05:30" / "UTC-04:00" / "UTC". */
export function localOffsetLabel(at: Date = new Date()): string {
  const minutes = -at.getTimezoneOffset();
  if (minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** "UTC" or "UTC+05:30 · Asia/Colombo". */
export function zoneLabel(zone: TimeZonePreference = current): string {
  if (zone === 'utc') return 'UTC';
  const name = localZoneName();
  const offset = localOffsetLabel();
  return name ? `${offset} · ${name}` : offset;
}

export interface DateTimeFormatOptions {
  /** Include seconds (default true). */
  seconds?: boolean;
  /** Include milliseconds (implies seconds). */
  ms?: boolean;
  /** Override the chosen zone for this value. */
  zone?: TimeZonePreference;
}

type DateInput = string | number | Date | undefined | null;

function parse(value: DateInput): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function parts(d: Date, zone: TimeZonePreference): Record<string, string> {
  // Assembled from parts so the shape does not depend on the browser's locale.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone === 'utc' ? 'UTC' : undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return out;
}

function clock(d: Date, p: Record<string, string>, opts: DateTimeFormatOptions): string {
  let time = `${p.hour}:${p.minute}`;
  if (opts.seconds !== false || opts.ms) time += `:${p.second}`;
  if (opts.ms) time += `.${String(d.getMilliseconds()).padStart(3, '0')}`;
  return time;
}

/** `2026-09-09 14:32:05`; "—" for nothing, the raw input for an unparseable string. */
export function formatDateTime(value: DateInput, opts: DateTimeFormatOptions = {}): string {
  const d = parse(value);
  if (!d) return value === undefined || value === null || value === '' ? '—' : String(value);
  const p = parts(d, opts.zone ?? current);
  return `${p.year}-${p.month}-${p.day} ${clock(d, p, opts)}`;
}

/** `2026-09-09` alone. */
export function formatDate(value: DateInput, zone: TimeZonePreference = current): string {
  const d = parse(value);
  if (!d) return '—';
  const p = parts(d, zone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `14:32:05` alone. */
export function formatClock(value: DateInput, opts: DateTimeFormatOptions = {}): string {
  const d = parse(value);
  if (!d) return '—';
  return clock(d, parts(d, opts.zone ?? current), opts);
}

/** The instant as ISO-8601 UTC. */
export function toIsoUtc(value: DateInput): string {
  const d = parse(value);
  return d ? d.toISOString() : '—';
}

/** "just now", "3 min ago", "2 hours ago", "5 days ago". */
export function formatDistanceToNow(dateStr: string | number | Date): string {
  const d = parse(dateStr);
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  if (diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}
