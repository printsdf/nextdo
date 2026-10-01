/**
 * Unit tests — the snooze sheet options (lib/snooze-options).
 *
 * All assertions use device-local Date constructors + getters, so they hold
 * in any host timezone (the mobile test script does not pin TZ). Dates are
 * mid-month so day arithmetic never crosses a month boundary.
 */
import {
  commonSnoozeOption,
  customSnoozeSeed,
  parseLocalDateTimeString,
  toLocalDateTimeString,
} from './snooze-options';

describe('commonSnoozeOption', () => {
  it('offers exactly the one common shortcut: 10 分钟后', () => {
    const now = new Date(2026, 8, 22, 10, 0, 0); // local Mon 2026-09-22 10:00
    const option = commonSnoozeOption(now);
    expect(option.id).toBe('in-10m');
    expect(option.label).toBe('10 分钟后');
    expect(option.target.getTime()).toBe(now.getTime() + 10 * 60_000);
  });
});

describe('customSnoozeSeed', () => {
  it('seeds the picker at now + 1h as a device-local string', () => {
    const now = new Date(2026, 8, 22, 10, 5, 0);
    expect(customSnoozeSeed(now)).toBe('2026-09-22T11:05');
  });

  it('crosses the local midnight when now + 1h is the next day', () => {
    const now = new Date(2026, 8, 22, 23, 30, 0);
    expect(customSnoozeSeed(now)).toBe('2026-09-23T00:30');
  });
});

describe('toLocalDateTimeString / parseLocalDateTimeString', () => {
  it('round-trips a device-local datetime (no UTC shift)', () => {
    const date = new Date(2026, 8, 22, 9, 5, 0);
    expect(parseLocalDateTimeString(toLocalDateTimeString(date))).toEqual(date);
  });

  it('parses as DEVICE-local hours (not UTC)', () => {
    const date = parseLocalDateTimeString('2026-09-22T08:05');
    expect(date).toEqual(new Date(2026, 8, 22, 8, 5, 0));
  });

  it('rejects malformed input', () => {
    expect(parseLocalDateTimeString('2026-09-22 08:05')).toBeNull();
    expect(parseLocalDateTimeString('2026-09-22T08:05:30')).toBeNull();
    expect(parseLocalDateTimeString('2026-09-22T24:00')).toBeNull();
    expect(parseLocalDateTimeString('2026-09-22T08:60')).toBeNull();
    expect(parseLocalDateTimeString('')).toBeNull();
  });
});
