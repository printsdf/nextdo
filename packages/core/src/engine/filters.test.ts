import type { CandidateAction, EngineInput } from './types';
import { hardFilter } from './filters';
import { HOUR_MS, NOW, iso, makeCalendar, makeHabit, makeNext } from './fixtures';

function input(
  actions: CandidateAction[],
  overrides: Partial<EngineInput> = {},
): EngineInput {
  return {
    actions,
    calendar: [],
    projects: [],
    context: { contextIds: ['computer', 'home'], availableMinutes: 60 },
    now: NOW,
    ...overrides,
  };
}

describe('hard filter — rule: snoozed', () => {
  it('excludes an action snoozed into the future', () => {
    const { filtered } = hardFilter(input([makeNext({ snoozedUntil: iso(2 * HOUR_MS) })]));
    expect(filtered).toEqual([{ actionId: 'action-1', rule: 'snoozed' }]);
  });

  it('boundary: snoozedUntil == now is not snoozed (strict >)', () => {
    const { ranked } = hardFilter(input([makeNext({ snoozedUntil: iso(0) })]));
    expect(ranked).toHaveLength(1);
  });

  it('a past snooze does not exclude', () => {
    const { ranked } = hardFilter(input([makeNext({ snoozedUntil: iso(-HOUR_MS) })]));
    expect(ranked).toHaveLength(1);
  });
});

describe('hard filter — rule: context-mismatch', () => {
  it('excludes an action whose contexts do not intersect when user has context filters', () => {
    const { filtered } = hardFilter(input([makeNext({ contextIds: ['office'] })]));
    expect(filtered).toEqual([{ actionId: 'action-1', rule: 'context-mismatch' }]);
  });

  it('an empty contextIds matches anywhere', () => {
    const { ranked } = hardFilter(input([makeNext({ contextIds: [] })]));
    expect(ranked).toHaveLength(1);
  });

  it('a single overlapping context passes', () => {
    const { ranked } = hardFilter(input([makeNext({ contextIds: ['office', 'home'] })]));
    expect(ranked).toHaveLength(1);
  });

  it('regression: default/empty user context ("any") matches actions with specific contexts', () => {
    const anyContextInput = input([makeNext({ contextIds: ['computer'] })], {
      context: { contextIds: [], availableMinutes: 60 },
    });
    const { ranked, filtered } = hardFilter(anyContextInput);
    expect(filtered).toHaveLength(0);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.id).toBe('action-1');
  });
});

describe('hard filter — rule: too-long', () => {
  it('excludes estMinutes > availableMinutes', () => {
    const { filtered } = hardFilter(input([makeNext({ estMinutes: 61 })]));
    expect(filtered).toEqual([{ actionId: 'action-1', rule: 'too-long' }]);
  });

  it('boundary: estMinutes == availableMinutes passes', () => {
    const { ranked } = hardFilter(input([makeNext({ estMinutes: 60 })]));
    expect(ranked).toHaveLength(1);
  });
});

describe('hard filter — rule: window-mismatch (device-local, TZ=UTC)', () => {
  it('weekday mask first: an excluded weekday drops the action', () => {
    // NOW is Monday (getDay() = 1)
    const { filtered } = hardFilter(input([makeNext({ windowDays: [2, 3, 4, 5] })]));
    expect(filtered).toEqual([{ actionId: 'action-1', rule: 'window-mismatch' }]);
    const { ranked } = hardFilter(input([makeNext({ windowDays: [1] })]));
    expect(ranked).toHaveLength(1);
  });

  it('before windowStart is outside', () => {
    const { filtered } = hardFilter(input([makeNext({ windowStart: '10:00' })]));
    expect(filtered).toEqual([{ actionId: 'action-1', rule: 'window-mismatch' }]);
  });

  it('at/after windowEnd is outside (end exclusive)', () => {
    const after = hardFilter(input([makeNext({ windowStart: '00:00', windowEnd: '08:00' })]));
    expect(after.filtered).toEqual([{ actionId: 'action-1', rule: 'window-mismatch' }]);
    const inside = hardFilter(input([makeNext({ windowStart: '00:00', windowEnd: '10:00' })]));
    expect(inside.ranked).toHaveLength(1);
  });

  it('a habit window at the local-midnight boundary', () => {
    const inside = hardFilter(
      input(
        [makeHabit({ windowStart: '00:00', windowEnd: '01:00' })],
        { now: new Date('2026-09-21T00:30:00.000Z') },
      ),
    );
    expect(inside.ranked).toHaveLength(1);
    const outside = hardFilter(
      input(
        [makeHabit({ windowStart: '00:00', windowEnd: '01:00' })],
        { now: new Date('2026-09-21T01:30:00.000Z') },
      ),
    );
    expect(outside.filtered).toEqual([{ actionId: 'action-1', rule: 'window-mismatch' }]);
  });
});

describe('hard filter — rule: dependency', () => {
  it('excludes while the dependency is open', () => {
    const { filtered } = hardFilter(input([makeNext({ dependencyDone: false })]));
    expect(filtered).toEqual([{ actionId: 'action-1', rule: 'dependency' }]);
  });

  it('passes when the pool resolved the dependency', () => {
    const { ranked } = hardFilter(input([makeNext({ dependsOnId: 'a-0', dependencyDone: true })]));
    expect(ranked).toHaveLength(1);
  });
});

describe('hard filter — rule: calendar-conflict (fixed-time candidates only)', () => {
  const calendarAction = makeCalendar({ id: 'cal-1', startsAt: iso(0), estMinutes: 30 });

  it('excludes on overlap with a foreign action block', () => {
    const inp = input([calendarAction], {
      calendar: [
        {
          start: iso(15 * 60_000),
          end: iso(45 * 60_000),
          sourceActionId: 'other-1',
        },
      ],
    });
    expect(hardFilter(inp).filtered).toEqual([{ actionId: 'cal-1', rule: 'calendar-conflict' }]);
  });

  it('a candidate never conflicts with its own block', () => {
    const inp = input([calendarAction], {
      calendar: [{ start: iso(0), end: iso(30 * 60_000), sourceActionId: 'cal-1' }],
    });
    const out = hardFilter(inp);
    expect(out.filtered).toEqual([]);
    // starts now → preempted, but never excluded by its own block
    expect(out.preempted.map((a) => a.id)).toEqual(['cal-1']);
  });

  it('non-action blocks (no sourceActionId) conflict too', () => {
    const inp = input([calendarAction], {
      calendar: [{ start: iso(10 * 60_000), end: iso(20 * 60_000) }],
    });
    expect(hardFilter(inp).filtered).toEqual([{ actionId: 'cal-1', rule: 'calendar-conflict' }]);
  });

  it('no overlap → passes', () => {
    // starts at +90 min (outside the preemption window) → stays in ranked
    const later = makeCalendar({ id: 'cal-1', startsAt: iso(90 * 60_000), estMinutes: 30 });
    const inp = input([later], {
      calendar: [{ start: iso(60 * 60_000), end: iso(90 * 60_000), sourceActionId: 'other-1' }],
    });
    expect(hardFilter(inp).ranked).toHaveLength(1);
  });

  it('non-calendar candidates are never calendar-conflicted', () => {
    const inp = input([makeNext()], {
      calendar: [{ start: iso(0), end: iso(60 * 60_000), sourceActionId: 'other-1' }],
    });
    expect(inp && hardFilter(inp).ranked).toHaveLength(1);
  });
});

describe('hard filter — fixed order & calendar preemption', () => {
  it('records the first failing rule (snoozed before too-long)', () => {
    const { filtered } = hardFilter(
      input([makeNext({ snoozedUntil: iso(HOUR_MS), estMinutes: 999 })]),
    );
    expect(filtered).toEqual([{ actionId: 'action-1', rule: 'snoozed' }]);
  });

  it('preempts a calendar candidate starting within the next 60 minutes', () => {
    const { preempted, ranked } = hardFilter(input([makeCalendar({ startsAt: iso(30 * 60_000) })]));
    expect(preempted).toHaveLength(1);
    expect(ranked).toHaveLength(0);
  });

  it('boundary: 61 minutes out is ranked, not preempted; already started is ranked', () => {
    const far = hardFilter(input([makeCalendar({ startsAt: iso(61 * 60_000) })]));
    expect(far.preempted).toHaveLength(0);
    expect(far.ranked).toHaveLength(1);
    const started = hardFilter(input([makeCalendar({ startsAt: iso(-60_000) })]));
    expect(started.preempted).toHaveLength(0);
    expect(started.ranked).toHaveLength(1);
  });

  it('every exclusion is recorded; survivors keep input order', () => {
    const { ranked, filtered } = hardFilter(
      input([
        makeNext({ id: 'ok-1' }),
        makeNext({ id: 'dep-1', dependencyDone: false }),
        makeNext({ id: 'ok-2' }),
        makeNext({ id: 'ctx-1', contextIds: ['office'] }),
      ]),
    );
    expect(ranked.map((a) => a.id)).toEqual(['ok-1', 'ok-2']);
    expect(filtered).toEqual([
      { actionId: 'dep-1', rule: 'dependency' },
      { actionId: 'ctx-1', rule: 'context-mismatch' },
    ]);
  });
});
