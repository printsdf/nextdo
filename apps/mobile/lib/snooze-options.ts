/**
 * Snooze sheet options (design.md §4.7 — shared by the Now screen and the
 * project detail): [10 分钟后, 30 分钟后, 今晚 20:00, 明天 08:00]. Once
 * tonight 20:00 has passed (or is the exact now), it becomes 明晚 20:00.
 *
 * Pure: `now` is injected (device clock via the app-level hook), all math
 * is device-local (setHours/getHours — the user's wall clock).
 */
export interface SnoozeOption {
  id: string;
  label: string;
  target: Date;
}

const TONIGHT_HOUR = 20;
const TOMORROW_HOUR = 8;

export function snoozeOptions(now: Date): SnoozeOption[] {
  const tonight = new Date(now);
  tonight.setHours(TONIGHT_HOUR, 0, 0, 0);
  const tonightPassed = tonight.getTime() <= now.getTime();
  if (tonightPassed) {
    tonight.setDate(tonight.getDate() + 1);
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(TOMORROW_HOUR, 0, 0, 0);

  return [
    { id: 'in-10m', label: '10 分钟后', target: new Date(now.getTime() + 10 * 60_000) },
    { id: 'in-30m', label: '30 分钟后', target: new Date(now.getTime() + 30 * 60_000) },
    {
      id: tonightPassed ? 'tomorrow-night' : 'tonight',
      label: tonightPassed ? '明晚 20:00' : '今晚 20:00',
      target: tonight,
    },
    { id: 'tomorrow-morning', label: '明天 08:00', target: tomorrow },
  ];
}
