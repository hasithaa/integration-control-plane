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

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { getTimeZonePreference, setTimeZonePreference, zoneLabel, type TimeZonePreference } from '../utils/time';

/**
 * Which clock every timestamp in the workflow pages is shown on: the browser's local zone, or UTC.
 *
 * One switch for all of those pages, not a format per view: a person comparing a workflow's start
 * time with a task's decision time and a reset point must be able to trust that all three are on
 * the same clock. The choice is per browser (localStorage) and defaults to local — operators
 * mostly read times as "when did this happen for me" — with UTC one click away for anyone
 * correlating across regions or with a server log. The chosen zone is always named beside the
 * pages' environment picker, so a time is never shown without saying whose clock it is on. The
 * provider sits at the app root so the choice carries across every workflow page; other areas
 * may adopt the same DateTime component and inherit it.
 */
interface TimeZoneState {
  zone: TimeZonePreference;
  /** Human name of the zone in effect: "UTC", or e.g. "UTC+05:30 · Asia/Colombo". */
  label: string;
  setZone: (zone: TimeZonePreference) => void;
  toggle: () => void;
}

const TimeZoneContext = createContext<TimeZoneState | null>(null);

export function TimeZoneProvider({ children }: { children: ReactNode }): JSX.Element {
  const [zone, setZoneState] = useState<TimeZonePreference>(getTimeZonePreference);
  // Keep the module-level preference in step so plain string formatting (log exports, copied
  // text) outside React reads the same zone the components render.
  useEffect(() => setTimeZonePreference(zone), [zone]);
  const setZone = useCallback((z: TimeZonePreference) => setZoneState(z), []);
  const toggle = useCallback(() => setZoneState((z) => (z === 'utc' ? 'local' : 'utc')), []);
  const value = useMemo<TimeZoneState>(() => ({ zone, label: zoneLabel(zone), setZone, toggle }), [zone, setZone, toggle]);
  return <TimeZoneContext.Provider value={value}>{children}</TimeZoneContext.Provider>;
}

/** The console's time-zone preference. Outside the provider (tests, isolated renders) it reads as local. */
export function useTimeZone(): TimeZoneState {
  const ctx = useContext(TimeZoneContext);
  return ctx ?? { zone: 'local', label: zoneLabel('local'), setZone: () => {}, toggle: () => {} };
}
