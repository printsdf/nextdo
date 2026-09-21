import { useEffect, useState } from 'react';

/**
 * The single app-level clock (spec: hook-guidelines Rule 4 — "All
 * time-sensitive logic receives `now` (from a single app-level clock hook
 * …which ticks on a minute interval) — hooks do not call `Date.now()`").
 *
 * Returns the current `Date`, re-evaluated once per minute. Every
 * time-sensitive hook receives `now` from here; none call `Date.now()`
 * themselves. (This is the one sanctioned place that reads the wall clock —
 * the engine itself always receives `now` as a parameter.)
 */
const TICK_MS = 60 * 1000;

export function useAppClock(): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  return now;
}
