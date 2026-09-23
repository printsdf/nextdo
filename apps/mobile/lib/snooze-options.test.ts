/**
 * Unit tests — the snooze sheet options (lib/snooze-options).
 *
 * All assertions use device-local Date constructors + getters, so they hold
 * in any host timezone (the mobile test script does not pin TZ). Dates are
 * mid-month so day arithmetic never crosses a month boundary.
 */
import { snoozeOptions } from './snooze-options';

const localDay = (date: Date): string =>
  `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

const hm = (date: Date): string =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

describe('snoozeOptions', () => {
  it('offers 10m / 30m / tonight 20:00 / tomorrow 08:00 mid-day', () => {
    const now = new Date(2026, 8, 22, 10, 0, 0); // local Mon 2026-09-22 10:00
    const options = snoozeOptions(now);
    expect(options.map((option) => option.label)).toEqual([
      '10 分钟后',
      '30 分钟后',
      '今晚 20:00',
      '明天 08:00',
    ]);
    expect(options[0]?.target.getTime()).toBe(now.getTime() + 10 * 60_000);
    expect(options[1]?.target.getTime()).toBe(now.getTime() + 30 * 60_000);
    const tonight = options[2];
    expect(localDay(tonight?.target ?? now)).toBe(localDay(now));
    expect(hm(tonight?.target ?? now)).toBe('20:00');
    const tomorrow = options[3];
    expect(localDay(tomorrow?.target ?? now)).toBe(localDay(new Date(2026, 8, 23, 12, 0, 0)));
    expect(hm(tomorrow?.target ?? now)).toBe('08:00');
  });

  it('keeps 今晚 20:00 at 19:59', () => {
    const now = new Date(2026, 8, 22, 19, 59, 0);
    const options = snoozeOptions(now);
    expect(options[2]?.label).toBe('今晚 20:00');
    expect(localDay(options[2]?.target ?? now)).toBe(localDay(now));
  });

  it('swaps to 明晚 20:00 at exactly 20:00 (snoozing to "now" is useless)', () => {
    const now = new Date(2026, 8, 22, 20, 0, 0);
    const options = snoozeOptions(now);
    expect(options[2]?.label).toBe('明晚 20:00');
    expect(localDay(options[2]?.target ?? now)).toBe(localDay(new Date(2026, 8, 23, 12, 0, 0)));
  });

  it('swaps to 明晚 20:00 late at night', () => {
    const now = new Date(2026, 8, 22, 23, 30, 0);
    const options = snoozeOptions(now);
    expect(options[2]?.label).toBe('明晚 20:00');
    expect(localDay(options[2]?.target ?? now)).toBe(localDay(new Date(2026, 8, 23, 12, 0, 0)));
    // 明天 08:00 still means the next local day.
    expect(localDay(options[3]?.target ?? now)).toBe(localDay(new Date(2026, 8, 23, 12, 0, 0)));
  });
});
