/**
 * Human-facing date formatting (project/conventions.md §Time — formatting
 * lives in the app; the DB keeps ISO-8601 UTC strings). Device-local by
 * design: a list row shows the day the user lives in, not UTC.
 */
import { localDateKey } from '@nextdo/core';

export function formatLocalDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    // Not a parseable timestamp — show the stored value rather than a lie.
    return iso;
  }
  return date.toLocaleDateString();
}

/** Device-local "date + HH:mm" (calendar startsAt, deadlines, reminders). */
export function formatLocalDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${date.toLocaleDateString()} ${time}`;
}

/** Device-local "HH:mm". */
function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** The localDateKey of `now`'s local day, shifted by `offsetDays`
 *  calendar days (wall-clock setDate — DST-safe). */
function localDayKeyOffset(now: Date, offsetDays: number): string {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + offsetDays);
  return localDateKey(day);
}

/**
 * Relative capture time for list rows (Inbox meta line):
 * 刚刚 (<60s) / {n} 分钟前 (<60m) / 今天 HH:mm / 昨天 HH:mm / M月D日.
 * Future timestamps (clock skew) fall through to the day-based labels —
 * never a negative "N 分钟前". Unparseable input is returned as-is.
 */
export function formatRelativeTime(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    // Not a parseable timestamp — show the stored value rather than a lie.
    return iso;
  }
  const diffMs = now.getTime() - date.getTime();
  const MINUTE_MS = 60_000;
  if (diffMs >= 0 && diffMs < MINUTE_MS) return '刚刚';
  if (diffMs >= 0 && diffMs < 60 * MINUTE_MS) {
    return `${Math.floor(diffMs / MINUTE_MS)} 分钟前`;
  }
  const key = localDateKey(date);
  if (key === localDayKeyOffset(now, 0)) return `今天 ${hhmm(date)}`;
  if (key === localDayKeyOffset(now, -1)) return `昨天 ${hhmm(date)}`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * Due label for deadline chips (Now rows + Projects): null → 随时;
 * today → 今天; tomorrow → 明天; else M月D日 (day-based, device-local).
 * Unparseable input is returned as-is.
 */
export function formatDueLabel(iso: string | null, now: Date): string {
  if (iso === null) return '随时';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const key = localDateKey(date);
  if (key === localDayKeyOffset(now, 0)) return '今天';
  if (key === localDayKeyOffset(now, 1)) return '明天';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
