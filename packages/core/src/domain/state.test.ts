import { ValidationNextdoError } from '../lib/errors';
import {
  ACTION_TRANSITIONS,
  FOCUS_SESSION_TRANSITIONS,
  HABIT_DAY_TRANSITIONS,
  HABIT_TRANSITIONS,
  PROJECT_TRANSITIONS,
  REMINDER_TRANSITIONS,
  assertTransition,
} from './state';

const NOW = new Date('2026-09-21T09:00:00.000Z');

describe('legal transitions pass', () => {
  it('project lifecycle', () => {
    assertTransition(PROJECT_TRANSITIONS, 'active', 'on-hold', NOW);
    assertTransition(PROJECT_TRANSITIONS, 'active', 'done', NOW);
    assertTransition(PROJECT_TRANSITIONS, 'active', 'dropped', NOW);
    assertTransition(PROJECT_TRANSITIONS, 'on-hold', 'active', NOW);
    assertTransition(PROJECT_TRANSITIONS, 'on-hold', 'done', NOW);
    assertTransition(PROJECT_TRANSITIONS, 'on-hold', 'dropped', NOW);
  });

  it('action lifecycle (open → done, both action kinds share it)', () => {
    assertTransition(ACTION_TRANSITIONS, 'open', 'done', NOW);
  });

  it('habit lifecycle (restart from broken allowed)', () => {
    assertTransition(HABIT_TRANSITIONS, 'active', 'completed', NOW);
    assertTransition(HABIT_TRANSITIONS, 'active', 'broken', NOW);
    assertTransition(HABIT_TRANSITIONS, 'broken', 'active', NOW);
  });

  it('habit day lifecycle', () => {
    assertTransition(HABIT_DAY_TRANSITIONS, 'open', 'done', NOW);
  });

  it('reminder lifecycle', () => {
    assertTransition(REMINDER_TRANSITIONS, 'scheduled', 'fired', NOW);
    assertTransition(REMINDER_TRANSITIONS, 'scheduled', 'cancelled', NOW);
  });

  it('focus session lifecycle', () => {
    assertTransition(FOCUS_SESSION_TRANSITIONS, 'active', 'completed', NOW);
    assertTransition(FOCUS_SESSION_TRANSITIONS, 'active', 'abandoned', NOW);
  });
});

describe('illegal transitions throw ValidationNextdoError with a stable code', () => {
  const cases: Array<[Record<string, readonly string[]>, string, string]> = [
    [PROJECT_TRANSITIONS, 'done', 'open'],
    [PROJECT_TRANSITIONS, 'done', 'active'],
    [PROJECT_TRANSITIONS, 'dropped', 'active'],
    [ACTION_TRANSITIONS, 'done', 'open'],
    [HABIT_TRANSITIONS, 'completed', 'active'],
    [HABIT_TRANSITIONS, 'broken', 'completed'],
    [HABIT_DAY_TRANSITIONS, 'done', 'open'],
    [REMINDER_TRANSITIONS, 'fired', 'scheduled'],
    [REMINDER_TRANSITIONS, 'cancelled', 'scheduled'],
    [FOCUS_SESSION_TRANSITIONS, 'completed', 'active'],
    [FOCUS_SESSION_TRANSITIONS, 'abandoned', 'active'],
  ];

  it.each(cases)('throws for %s → %s', (table, from, to) => {
    let err: unknown;
    try {
      assertTransition(table as never, from, to, NOW);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationNextdoError);
    expect((err as ValidationNextdoError).code).toBe(`invalid-transition:${from}:${to}`);
  });
});
