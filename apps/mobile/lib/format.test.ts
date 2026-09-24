/**
 * Unit tests — the date formatting helpers (lib/format).
 *
 * The mobile test script does not pin TZ, so every date is built with a
 * DEVICE-LOCAL Date constructor and converted to ISO via toISOString() —
 * the helper and the assertion then operate in the same local frame, in
 * any host timezone. Dates are mid-month unless a test is about crossing
 * a month boundary.
 */
import { formatDueLabel, formatRelativeTime } from './format';

const NOW = new Date(2026, 8, 24, 10, 0, 0); // local Thu 2026-09-24 10:00
const iso = (date: Date): string => date.toISOString();

describe('formatRelativeTime', () => {
  it('刚刚 within 60s (exactly 60s already rounds up to 1 分钟前)', () => {
    expect(formatRelativeTime(iso(new Date(NOW.getTime() - 30_000)), NOW)).toBe('刚刚');
    expect(formatRelativeTime(iso(new Date(NOW.getTime() - 60_000)), NOW)).toBe('1 分钟前');
  });

  it('{n} 分钟前 within 60m (floored)', () => {
    expect(formatRelativeTime(iso(new Date(NOW.getTime() - 5 * 60_000)), NOW)).toBe('5 分钟前');
    expect(formatRelativeTime(iso(new Date(NOW.getTime() - 59 * 60_000)), NOW)).toBe('59 分钟前');
  });

  it('今天 HH:mm on the same local day (from a full hour ago)', () => {
    expect(formatRelativeTime(iso(new Date(2026, 8, 24, 8, 30, 0)), NOW)).toBe('今天 08:30');
    // exactly 60m ago is no longer "N 分钟前"
    expect(formatRelativeTime(iso(new Date(NOW.getTime() - 60 * 60_000)), NOW)).toBe('今天 09:00');
  });

  it('昨天 HH:mm for the previous local day', () => {
    expect(formatRelativeTime(iso(new Date(2026, 8, 23, 8, 5, 0)), NOW)).toBe('昨天 08:05');
  });

  it('M月D日 beyond yesterday (incl. cross-month)', () => {
    expect(formatRelativeTime(iso(new Date(2026, 8, 10, 12, 0, 0)), NOW)).toBe('9月10日');
    expect(formatRelativeTime(iso(new Date(2026, 7, 30, 12, 0, 0)), NOW)).toBe('8月30日');
  });

  it('future timestamps get the day-based label (never a negative count)', () => {
    // 30 minutes in the future, still today → 今天 HH:mm.
    expect(formatRelativeTime(iso(new Date(2026, 8, 24, 10, 30, 0)), NOW)).toBe('今天 10:30');
    // tomorrow → M月D日.
    expect(formatRelativeTime(iso(new Date(2026, 8, 25, 10, 0, 0)), NOW)).toBe('9月25日');
  });

  it('unparseable input is returned as-is', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('not-a-date');
  });
});

describe('formatDueLabel', () => {
  it('null → 随时', () => {
    expect(formatDueLabel(null, NOW)).toBe('随时');
  });

  it('today → 今天 (late in the day still 今天)', () => {
    expect(formatDueLabel(iso(new Date(2026, 8, 24, 9, 0, 0)), NOW)).toBe('今天');
    expect(formatDueLabel(iso(new Date(2026, 8, 24, 23, 59, 0)), NOW)).toBe('今天');
  });

  it('tomorrow → 明天', () => {
    expect(formatDueLabel(iso(new Date(2026, 8, 25, 0, 0, 0)), NOW)).toBe('明天');
    expect(formatDueLabel(iso(new Date(2026, 8, 25, 18, 30, 0)), NOW)).toBe('明天');
  });

  it('other days → M月D日 (incl. yesterday and cross-month)', () => {
    expect(formatDueLabel(iso(new Date(2026, 8, 23, 0, 0, 0)), NOW)).toBe('9月23日');
    expect(formatDueLabel(iso(new Date(2026, 9, 5, 0, 0, 0)), NOW)).toBe('10月5日');
    expect(formatDueLabel(iso(new Date(2026, 7, 30, 0, 0, 0)), NOW)).toBe('8月30日');
  });

  it('unparseable input is returned as-is', () => {
    expect(formatDueLabel('not-a-date', NOW)).toBe('not-a-date');
  });
});
