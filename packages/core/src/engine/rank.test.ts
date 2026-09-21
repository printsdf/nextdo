import type { EngineInput } from './types';
import { NOW, iso, makeCalendar, makeHabit, makeNext } from './fixtures';
import { scoreCandidate } from './rank';

function input(
  candidate: EngineInput['actions'][number],
  overrides: Partial<EngineInput> = {},
): EngineInput {
  return {
    actions: [candidate],
    calendar: [],
    projects: [],
    context: { contextIds: ['computer'], availableMinutes: 60 },
    now: NOW,
    ...overrides,
  };
}

describe('deadline-urgency — band edges inclusive on the upper bound', () => {
  const bands: Array<[string, number, number]> = [
    ['overdue (h < 0)', -1, 1.0],
    ['exactly 24 h (h <= 24)', 24, 0.9],
    ['24 h + 1 min', 24 + 1 / 60, 0.7],
    ['exactly 72 h (h <= 72) — "3 天后"', 72, 0.7],
    ['72 h + 1 min', 72 + 1 / 60, 0.4],
    ['exactly 168 h (h <= 168)', 168, 0.4],
    ['168 h + 1 min', 168 + 1 / 60, 0],
  ];

  it.each(bands)('h = %s (%s hours) → signal %s', (_label, hours, expected) => {
    const c = makeNext({ deadline: iso(hours * 3_600_000) });
    expect(scoreCandidate(c, input(c)).signals['deadline-urgency']).toBe(expected);
  });

  it('no deadline → 0', () => {
    expect(scoreCandidate(makeNext(), input(makeNext())).signals['deadline-urgency']).toBe(0);
  });
});

describe('goal-value', () => {
  it('signal = value / 5', () => {
    for (const value of [1, 2, 3, 4, 5] as const) {
      const c = makeNext({ value });
      expect(scoreCandidate(c, input(c)).signals['goal-value']).toBeCloseTo(value / 5, 10);
    }
  });

  it('is the deciding factor between two otherwise-identical actions', () => {
    const low = makeNext({ id: 'low', value: 2 });
    const high = makeNext({ id: 'high', value: 5 });
    const sLow = scoreCandidate(low, input(low));
    const sHigh = scoreCandidate(high, input(high));
    expect(sHigh.score).toBeGreaterThan(sLow.score);
  });
});

describe('project-importance', () => {
  const project = { id: 'p-1', value: 4, status: 'active' };

  it('signal = project.value / 5 for an active project', () => {
    const c = makeNext({ projectId: 'p-1' });
    expect(scoreCandidate(c, input(c, { projects: [project] })).signals['project-importance']).toBe(
      0.8,
    );
  });

  it('an on-hold or missing project contributes 0', () => {
    const c = makeNext({ projectId: 'p-1' });
    expect(
      scoreCandidate(c, input(c, { projects: [{ ...project, status: 'on-hold' }] }))
        .signals['project-importance'],
    ).toBe(0);
    expect(scoreCandidate(c, input(c, { projects: [] })).signals['project-importance']).toBe(0);
  });
});

describe('time-fit', () => {
  it('signal = max(0, 1 − estMinutes / availableMinutes)', () => {
    const c = makeNext({ estMinutes: 10 });
    expect(scoreCandidate(c, input(c)).signals['time-fit']).toBeCloseTo(1 - 10 / 60, 10);
  });

  it('is the deciding factor when everything else is equal', () => {
    const short = makeNext({ id: 'short', estMinutes: 10 });
    const long = makeNext({ id: 'long', estMinutes: 50 });
    expect(scoreCandidate(short, input(short)).score).toBeGreaterThan(
      scoreCandidate(long, input(long)).score,
    );
  });

  it('clamps at 0', () => {
    const c = makeNext({ estMinutes: 60 });
    expect(scoreCandidate(c, input(c)).signals['time-fit']).toBe(0);
  });
});

describe('waiting-time', () => {
  it('grows with age, capped at 14 days', () => {
    const day = 24 * 3_600_000;
    const fresh = makeNext({ createdAt: iso(0) });
    expect(scoreCandidate(fresh, input(fresh)).signals['waiting-time']).toBe(0);

    const week = makeNext({ createdAt: iso(-7 * day) });
    expect(scoreCandidate(week, input(week)).signals['waiting-time']).toBeCloseTo(7 / 14, 10);

    const old = makeNext({ createdAt: iso(-30 * day) });
    expect(scoreCandidate(old, input(old)).signals['waiting-time']).toBeCloseTo(1, 10);
  });

  it('a snooze restarts the wait (max of createdAt / lastSnoozedAt)', () => {
    const day = 24 * 3_600_000;
    const c = makeNext({ createdAt: iso(-30 * day), lastSnoozedAt: iso(-1 * day) });
    expect(scoreCandidate(c, input(c)).signals['waiting-time']).toBeCloseTo(1 / 14, 10);
  });
});

describe('habit-commitment', () => {
  it('base 0.5 for a habit candidate', () => {
    const c = makeHabit();
    expect(scoreCandidate(c, input(c)).signals['habit-commitment']).toBe(0.5);
  });

  it('+0.5 when now ≥ windowEnd − ⅓ × window length', () => {
    // window 08:00–11:00 (180 min); threshold = 11:00 − 60 = 10:00
    const before = makeHabit({ windowStart: '08:00', windowEnd: '11:00' });
    const sBefore = scoreCandidate(before, input(before)).signals['habit-commitment'];
    expect(sBefore).toBe(0.5);

    const after = makeHabit({ windowStart: '08:00', windowEnd: '11:00' });
    const sAfter = scoreCandidate(after, input(after, { now: new Date('2026-09-21T10:40:00.000Z') }))
      .signals['habit-commitment'];
    expect(sAfter).toBe(1.0);
  });

  it('non-habit candidates get 0', () => {
    expect(scoreCandidate(makeNext(), input(makeNext())).signals['habit-commitment']).toBe(0);
    const cal = makeCalendar();
    expect(scoreCandidate(cal, input(cal)).signals['habit-commitment']).toBe(0);
  });
});

describe('health-protection — weighted boost, not a top-slot guarantee', () => {
  it('a value-3 health action beats an otherwise-identical value-5 work action', () => {
    // est = available → time-fit 0, so the spec's worked numbers apply
    const health = makeNext({ id: 'h', value: 3, estMinutes: 60, category: 'health' });
    const work = makeNext({ id: 'w', value: 5, estMinutes: 60, category: 'work' });
    const sHealth = scoreCandidate(health, input(health));
    const sWork = scoreCandidate(work, input(work));
    expect(sHealth.score).toBeCloseTo(0.88, 10);
    expect(sWork.score).toBeCloseTo(0.8, 10);
    expect(sHealth.score).toBeGreaterThan(sWork.score);
  });

  it('a deadline still outranks the health boost', () => {
    const health = makeNext({ id: 'h', value: 3, estMinutes: 60, category: 'health' });
    const work = makeNext({
      id: 'w',
      value: 5,
      estMinutes: 60,
      category: 'work',
      deadline: iso(72 * 3_600_000),
    });
    const sHealth = scoreCandidate(health, input(health)).score;
    const sWork = scoreCandidate(work, input(work)).score;
    expect(sWork).toBeCloseTo(1.5, 10);
    expect(sWork).toBeGreaterThan(sHealth);
  });

  it('non-health categories get 0', () => {
    expect(scoreCandidate(makeNext({ category: 'work' }), input(makeNext())).signals['health-protection']).toBe(0);
  });
});

describe('score = Σ W[c] × signal(c)', () => {
  it('sums the weighted signals exactly', () => {
    const c = makeNext({
      value: 4,
      estMinutes: 30,
      deadline: iso(48 * 3_600_000),
    });
    const { score, signals } = scoreCandidate(c, input(c));
    const expected =
      1.0 * signals['deadline-urgency'] +
      0.8 * signals['goal-value'] +
      0.6 * signals['project-importance'] +
      0.2 * signals['time-fit'] +
      0.2 * signals['waiting-time'] +
      0.5 * signals['habit-commitment'] +
      0.4 * signals['health-protection'];
    expect(score).toBeCloseTo(expected, 12);
  });

  it('emits a score reason for every signal > 0 and none otherwise', () => {
    const c = makeNext({ value: 4, estMinutes: 30, deadline: iso(48 * 3_600_000) });
    const { reasons } = scoreCandidate(c, input(c));
    const codes = reasons.map((r) => r.code).sort();
    expect(codes).toEqual(
      ['deadline-urgency', 'goal-value', 'time-fit'].sort(),
    );
    expect(reasons.every((r) => r.type === 'score')).toBe(true);
  });
});
