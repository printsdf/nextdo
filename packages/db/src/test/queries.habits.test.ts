/**
 * Query tests — Habits + HabitDays (spec: domain/domain-model.md "Habit
 * (+ HabitDay)"), including the start-challenge transaction and its
 * idempotent day seeding (invariant 5: deterministic
 * `hd-<habitId>-<YYYYMMDD>` ids).
 */
import {
  localDateKey,
  toIso,
  ulid,
  type Habit,
  type Value,
} from '@nextdo/core';
import {
  addHabit,
  listHabits,
  listHabitDays,
  startHabit,
  trashHabit,
  updateHabit,
} from '../queries/habits';
import { openTestDb, type TestDb } from './query-helpers';
import { FIXTURE_IDS, FIXTURE_NOW, fixtureHabitDayId } from './fixtures';

const H = FIXTURE_IDS.habits;
const TODAY_KEY = localDateKey(FIXTURE_NOW);

let env: TestDb | null = null;
afterEach(async () => {
  if (env !== null) {
    await env.close();
    env = null;
  }
});
async function open(seed = false, now: Date = FIXTURE_NOW): Promise<TestDb> {
  env = await openTestDb(seed, now);
  return env;
}

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: ulid(FIXTURE_NOW),
    createdAt: toIso(FIXTURE_NOW),
    updatedAt: toIso(FIXTURE_NOW),
    deletedAt: null,
    title: '21 天习惯',
    actionTitle: '每天做',
    estMinutes: 15,
    value: 3 as Value,
    cycleDays: 21,
    startedAt: toIso(FIXTURE_NOW),
    status: 'active',
    ...overrides,
  };
}

describe('reads', () => {
  it('lists [] on an empty database', async () => {
    const { db, close } = await open();
    try {
      expect(await listHabits(db)).toEqual([]);
      expect(await listHabitDays(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('lists the six seeded habits', async () => {
    const { db, close } = await open(true);
    try {
      expect(await listHabits(db)).toHaveLength(6);
    } finally {
      await close();
    }
  });

  it('listHabitDays filters by habitId and localDate', async () => {
    const { db, close } = await open(true);
    try {
      expect(await listHabitDays(db)).toHaveLength(7);
      const mid = await listHabitDays(db, { habitId: H.mid });
      expect(mid).toHaveLength(2); // today (open) + yesterday (done)
      const today = await listHabitDays(db, { localDate: TODAY_KEY });
      expect(today).toHaveLength(5); // today, mid, last, weekdays, completed
      const yesterday = await listHabitDays(db, {
        localDate: localDateKey(new Date(FIXTURE_NOW.getTime() - 86_400_000)),
      });
      expect(yesterday).toHaveLength(2); // mid (done) + broken (open, derived "missed")
    } finally {
      await close();
    }
  });
});

describe('CRUD + transitions', () => {
  it('add: inserts a valid habit; rejects a non-positive cycleDays', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit();
      await addHabit(db, habit);
      expect(await listHabits(db)).toHaveLength(1);
      await expect(addHabit(db, makeHabit({ cycleDays: 0 }))).rejects.toMatchObject({
        code: 'validation.habit.cycleDays',
      });
    } finally {
      await close();
    }
  });

  it('update: completed is terminal (completed → active is illegal)', async () => {
    const { db, close } = await open(true);
    try {
      const completed = (await listHabits(db)).find((habit) => habit.id === H.completed);
      await expect(
        updateHabit(db, { ...(completed as Habit), status: 'active', updatedAt: toIso(FIXTURE_NOW) }),
      ).rejects.toMatchObject({ code: 'invalid-transition:completed:active' });
    } finally {
      await close();
    }
  });

  it('update: broken → active re-starts the challenge and (re-)seeds today', async () => {
    const { db, close } = await open(true);
    try {
      const broken = (await listHabits(db)).find((habit) => habit.id === H.broken);
      await updateHabit(db, { ...(broken as Habit), status: 'active', updatedAt: toIso(FIXTURE_NOW) });
      // today (09-21) is cycle day 6 of the 7-day cycle starting 09-16 → seeded
      const days = await listHabitDays(db, { habitId: H.broken, localDate: TODAY_KEY });
      expect(days).toHaveLength(1);
      expect(days[0]?.id).toBe(fixtureHabitDayId(H.broken, 0));
      expect(days[0]?.status).toBe('open');
    } finally {
      await close();
    }
  });

  it('trash: soft-deletes the habit; the day rows stay', async () => {
    const { db, close } = await open(true);
    try {
      await trashHabit(db, { id: H.today, now: FIXTURE_NOW });
      expect((await listHabits(db)).map((habit) => habit.id)).not.toContain(H.today);
      expect(await listHabitDays(db, { habitId: H.today })).toHaveLength(1);
      await expect(trashHabit(db, { id: H.today, now: FIXTURE_NOW })).rejects.toMatchObject({
        code: 'habit.not-found',
      });
    } finally {
      await close();
    }
  });
});

describe('startHabit (the start-challenge transaction)', () => {
  it('inserts the habit and seeds today’s day in one transaction', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit();
      const { habit: stored, today } = await startHabit(db, habit, FIXTURE_NOW);
      expect(stored.id).toBe(habit.id);
      expect(today).not.toBeNull();
      expect(today?.id).toBe(fixtureHabitDayId(habit.id, 0));
      expect(today?.habitId).toBe(habit.id);
      expect(today?.localDate).toBe(TODAY_KEY);
      expect(today?.status).toBe('open');
    } finally {
      await close();
    }
  });

  it('refuses a habit that is not active', async () => {
    const { db, close } = await open();
    try {
      await expect(
        startHabit(db, makeHabit({ status: 'broken' }), FIXTURE_NOW),
      ).rejects.toMatchObject({ code: 'habit.start-not-active' });
      expect(await listHabits(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('no day row when today is outside the weekday mask (habit row is stored)', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit({ windowDays: [0, 6] }); // weekend only — today is Monday
      const { today } = await startHabit(db, habit, FIXTURE_NOW);
      expect(today).toBeNull();
      expect(await listHabits(db)).toHaveLength(1);
      expect(await listHabitDays(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('day generation is idempotent (re-starting never creates duplicates)', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit();
      await startHabit(db, habit, FIXTURE_NOW);
      // active → broken → active: the re-seed finds the existing day row.
      await updateHabit(db, { ...habit, status: 'broken', updatedAt: toIso(FIXTURE_NOW) });
      await updateHabit(db, { ...habit, status: 'active', updatedAt: toIso(FIXTURE_NOW) });
      const days = await listHabitDays(db, { habitId: habit.id, localDate: TODAY_KEY });
      expect(days).toHaveLength(1);
    } finally {
      await close();
    }
  });
});
