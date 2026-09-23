/**
 * Pure-function tests — `lib/review-dates`: device-local day math for the
 * daily review's reschedule / tomorrow-must-do targets.
 */
import { localDateKey, localDayAt, tomorrowAt } from './review-dates';

// All assertions are against DEVICE-LOCAL getters — the helpers must not
// interpret anything as UTC.
const NOW = new Date(2026, 8, 23, 15, 30, 0); // local 2026-09-23 15:30

describe('localDayAt', () => {
  it('parses a YYYY-MM-DD key to that local day at 08:00 by default', () => {
    const target = localDayAt('2026-09-24');
    expect(target).not.toBeNull();
    expect(target?.getFullYear()).toBe(2026);
    expect(target?.getMonth()).toBe(8); // September
    expect(target?.getDate()).toBe(24);
    expect(target?.getHours()).toBe(8);
    expect(target?.getMinutes()).toBe(0);
    expect(target?.getSeconds()).toBe(0);
  });

  it('honours a custom hour', () => {
    const target = localDayAt('2026-09-24', 20);
    expect(target?.getHours()).toBe(20);
  });

  it('trims surrounding whitespace', () => {
    expect(localDayAt(' 2026-09-24 ')).not.toBeNull();
  });

  it.each(['garbage', '2026/09/24', '2026-9-4', '2026-09-24T08:00'])('rejects malformed keys: %s', (key) => {
    expect(localDayAt(key)).toBeNull();
  });

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-09-00'])('rejects impossible dates: %s', (key) => {
    // 2026-02-30 would roll over to Mar 2 — a rollover is a rejection,
    // not a correction.
    expect(localDayAt(key)).toBeNull();
  });

  it('accepts a real leap-day', () => {
    expect(localDayAt('2028-02-29')).not.toBeNull();
  });
});

describe('tomorrowAt', () => {
  it('returns the next local day at 08:00 by default', () => {
    const target = tomorrowAt(8, NOW);
    expect(target.getFullYear()).toBe(2026);
    expect(target.getMonth()).toBe(8);
    expect(target.getDate()).toBe(24);
    expect(target.getHours()).toBe(8);
  });

  it('crosses month and year boundaries on the wall clock', () => {
    expect(tomorrowAt(8, new Date(2026, 8, 30, 23, 59)).getDate()).toBe(1);
    expect(tomorrowAt(8, new Date(2026, 11, 31, 23, 59)).getMonth()).toBe(0);
    expect(tomorrowAt(8, new Date(2026, 11, 31, 23, 59)).getFullYear()).toBe(2027);
  });

  it('honours a custom hour', () => {
    expect(tomorrowAt(20, NOW).getHours()).toBe(20);
  });
});

describe('localDateKey', () => {
  it('formats the device-local day as YYYY-MM-DD (zero-padded)', () => {
    expect(localDateKey(NOW)).toBe('2026-09-23');
    expect(localDateKey(new Date(2026, 0, 5, 9, 7))).toBe('2026-01-05');
  });
});
