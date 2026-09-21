/**
 * Shared test fixtures for the engine (co-located tests use a fixed
 * `now` + injected clocks per spec: domain/next-action-engine.md
 * "Determinism & Testing").
 */
import type { CalendarCandidate, HabitCandidate, NextCandidate } from './types';

/** Fixed reference "now": Monday 2026-09-21 09:00 UTC (device TZ pinned to UTC in test-setup). */
export const NOW = new Date('2026-09-21T09:00:00.000Z');

export function iso(msFromNow: number): string {
  return new Date(NOW.getTime() + msFromNow).toISOString();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const HOUR_MS = HOUR;

export function makeNext(overrides: Partial<NextCandidate> = {}): NextCandidate {
  return {
    id: 'action-1',
    kind: 'next',
    title: 'Test action',
    contextIds: [],
    estMinutes: 30,
    value: 3,
    consecutiveSkips: 0,
    dependencyDone: true,
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

export function makeHabit(overrides: Partial<HabitCandidate> = {}): HabitCandidate {
  return {
    ...makeNext(),
    kind: 'habit',
    habitId: 'habit-1',
    cycleDay: 5,
    cycleDays: 21,
    ...overrides,
  };
}

export function makeCalendar(overrides: Partial<CalendarCandidate> = {}): CalendarCandidate {
  return {
    ...makeNext(),
    kind: 'calendar',
    startsAt: NOW.toISOString(),
    ...overrides,
  };
}

export { MINUTE };
