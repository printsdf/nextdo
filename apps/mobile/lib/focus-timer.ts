/**
 * Pure focus-timer math (design.md §4.6): elapsed/remaining as a function
 * of (startedAt, plannedMinutes, pausedSec, now).
 *
 * The focus screen's 1-second tick feeds `now` for DISPLAY ONLY; every db
 * mutation takes `now` from `useAppClock` (hook-guidelines Rule 4).
 * `pausedSec` is the ABSOLUTE accumulated pause total (the db contract —
 * `recordPause` writes the total back, the pause-START instant is screen
 * state).
 */

/** Seconds actually worked so far (wall time minus accumulated pause). */
export function elapsedSeconds(startedAt: Date, pausedSec: number, now: Date): number {
  const rawSeconds = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
  return Math.max(0, rawSeconds - pausedSec);
}

/**
 * Seconds left on a PRESET session. Null for the free timer (no target —
 * the screen counts up with `elapsedSeconds` instead). May go negative
 * once the timer has run past its target (the display clamps at 0 and the
 * "time up" banner takes over — the session stays active until the user
 * confirms).
 */
export function remainingSeconds(
  startedAt: Date,
  plannedMinutes: number | null,
  pausedSec: number,
  now: Date,
): number | null {
  if (plannedMinutes === null) return null;
  return plannedMinutes * 60 - elapsedSeconds(startedAt, pausedSec, now);
}

/** True when a preset session has reached (or passed) its target. */
export function isTimeUp(
  startedAt: Date,
  plannedMinutes: number | null,
  pausedSec: number,
  now: Date,
): boolean {
  const remaining = remainingSeconds(startedAt, plannedMinutes, pausedSec, now);
  return remaining !== null && remaining <= 0;
}

/** mm:ss (or h:mm:ss past one hour) for display; negative clamps to 00:00. */
export function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
