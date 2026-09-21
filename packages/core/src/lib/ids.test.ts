import { habitDayId, ulid } from './ids';

describe('ulid', () => {
  it('is 26 Crockford-base32 characters (no I, L, O, U)', () => {
    const id = ulid(new Date('2026-09-21T09:00:00.000Z'));
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNPQRSTV-Z]{26}$/);
  });

  it('is sortable: later timestamps sort after earlier ones', () => {
    const a = ulid(new Date('2026-09-21T09:00:00.000Z'), () => 0.9);
    const b = ulid(new Date('2026-09-21T09:00:01.000Z'), () => 0.1);
    expect(a < b).toBe(true);
  });

  it('shares the 10-char timestamp prefix for the same millisecond', () => {
    const a = ulid(new Date('2026-09-21T09:00:00.123Z'), () => 0.1);
    const b = ulid(new Date('2026-09-21T09:00:00.123Z'), () => 0.9);
    expect(a.slice(0, 10)).toBe(b.slice(0, 10));
    expect(a).not.toBe(b);
  });

  it('is deterministic for an injected rng', () => {
    const a = ulid(new Date('2026-09-21T09:00:00.000Z'), () => 0);
    const b = ulid(new Date('2026-09-21T09:00:00.000Z'), () => 0);
    expect(a).toBe(b);
  });

  it('clamps the timestamp to 48 bits for very old dates', () => {
    const id = ulid(new Date(-86_400_000), () => 0.5);
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNPQRSTV-Z]{26}$/);
  });
});

describe('habitDayId', () => {
  it('is the deterministic hd-<habitId>-<YYYYMMDD>', () => {
    expect(habitDayId('habit-1', '20260921')).toBe('hd-habit-1-20260921');
  });
});
