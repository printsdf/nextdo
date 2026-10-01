/**
 * Snooze sheet options — acceptance feedback 2026-10-01 (supersedes the
 * 09-22-app-ui-screens design §4.7 four-option list): at most ONE common
 * shortcut (10 分钟后) + a fully custom time (the sheet opens the app's
 * chip-based DateTimePicker in 'datetime' mode). The fixed 30m / 今晚 20:00
 * / 明天 08:00 presets are gone — anything else is custom.
 *
 * Pure: `now` is injected (device clock via the app-level hook), all math
 * is device-local (the user's wall clock).
 */
export interface SnoozeOption {
  id: string;
  label: string;
  target: Date;
}

const COMMON_SNOOZE_MINUTES = 10;
/** The custom picker's seed: one hour from now. */
const CUSTOM_SEED_MINUTES = 60;

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

/** The ONE common shortcut: 10 分钟后 (now + 10 min, device-local). */
export function commonSnoozeOption(now: Date): SnoozeOption {
  return {
    id: `in-${COMMON_SNOOZE_MINUTES}m`,
    label: `${COMMON_SNOOZE_MINUTES} 分钟后`,
    target: new Date(now.getTime() + COMMON_SNOOZE_MINUTES * 60_000),
  };
}

/**
 * The DateTimePicker seed for the 自定义时间 row: now + 1h as the picker's
 * 'YYYY-MM-DDTHH:mm' device-local string.
 */
export function customSnoozeSeed(now: Date): string {
  return toLocalDateTimeString(new Date(now.getTime() + CUSTOM_SEED_MINUTES * 60_000));
}

/** Device-local 'YYYY-MM-DDTHH:mm' (the DateTimePicker 'datetime' contract). */
export function toLocalDateTimeString(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Parse the picker's 'YYYY-MM-DDTHH:mm' string as a DEVICE-LOCAL datetime
 * (explicit Date constructor — never `new Date(string)`, whose local-time
 * interpretation of offset-less input is engine-dependent).
 */
export function parseLocalDateTimeString(value: string): Date | null {
  const match = LOCAL_DATE_TIME.exec(value);
  if (match === null) return null;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    0,
    0,
  );
}
