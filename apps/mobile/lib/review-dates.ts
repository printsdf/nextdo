/**
 * Review scheduling targets (design.md §4.5): the device-local day math for
 * "reschedule to <date> 08:00" and "tomorrow must-do 08:00". Pure — the
 * device clock arrives as `now` (hook-guidelines Rule 4); no `Date.now()`.
 *
 * Date keys are `YYYY-MM-DD` (the same format the deadline inputs use),
 * interpreted as DEVICE-LOCAL calendar days — the same wall-clock
 * convention as `lib/snooze-options`.
 */

const RESCHEDULE_HOUR = 8;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a device-local `YYYY-MM-DD` key into the `Date` for that local day
 * at `hour` (default 08:00). Returns `null` for malformed keys or
 * impossible dates (`2026-02-30` would otherwise roll over to Mar 2) —
 * the caller shows a validation hint instead of guessing.
 */
export function localDayAt(dateKey: string, hour: number = RESCHEDULE_HOUR): Date | null {
  const match = DATE_KEY_RE.exec(dateKey.trim());
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const target = new Date(year, month - 1, day, hour, 0, 0, 0);
  if (
    target.getFullYear() !== year ||
    target.getMonth() !== month - 1 ||
    target.getDate() !== day
  ) {
    return null;
  }
  return target;
}

/** Tomorrow's local day at `hour` (default 08:00) — the "明日必做" target. */
export function tomorrowAt(hour: number = RESCHEDULE_HOUR, now: Date): Date {
  const target = new Date(now);
  target.setDate(target.getDate() + 1);
  target.setHours(hour, 0, 0, 0);
  return target;
}

/** The device-local `YYYY-MM-DD` key for `now`'s calendar day. */
export function localDateKey(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
