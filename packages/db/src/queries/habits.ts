/**
 * Habit + HabitDay queries (spec: domain/domain-model.md "Habit (+
 * HabitDay)").
 *
 * `startHabit` is the start-challenge transaction: insert the Habit and
 * seed today's HabitDay in ONE transaction. Seeding follows the
 * cycle/window rules:
 *
 * - weekday mask first — no row when `windowDays` is set and today's
 *   device-local weekday is not in it (the HH:mm window only gates
 *   eligibility at recommendation time, never row generation);
 * - the day must fall inside the challenge cycle
 *   (`habitCycleDay(startedAt, cycleDays, today)`, shared with the pool
 *   query — not duplicated here);
 * - generation is idempotent: the deterministic id `hd-<habitId>-<YYYYMMDD>`
 *   (domain-model.md invariant 5) makes a re-run a no-op, so offline
 *   multi-device generation never creates duplicates (Proposal §10).
 *
 * `missed` is never written — a past `localDate` whose row is not done is
 * derived at query time.
 */
import {
  HABIT_TRANSITIONS,
  StorageNextdoError,
  ValidationNextdoError,
  assertTransition,
  assertValidHabit,
  assertValidHabitDay,
  habitDayId,
  localDateKey,
  parseIso,
  toIso,
  type Habit,
  type HabitDay,
  type HabitStatus,
} from '@nextdo/core';
import type { Transaction } from 'kysely';
import { habitDayFromRow, habitDayToRow, habitFromRow, habitToRow, type Database } from '../schema';
import { habitCycleDay } from './pool';
import type { NextdoDb } from '../types';

async function loadHabitRow(db: NextdoDb, habitId: string) {
  const row = await db.selectFrom('habits').selectAll().where('id', '=', habitId).executeTakeFirst();
  if (row === undefined || row.deleted_at !== null) {
    throw new StorageNextdoError('habit.not-found', `No live habit with id ${habitId}`);
  }
  return row;
}

/**
 * Seed today's HabitDay for a habit (idempotent — returns the existing row
 * when the deterministic id is already present). Returns null when today
 * is outside the weekday mask or the challenge cycle.
 */
async function seedTodayHabitDay(
  tx: Transaction<Database>,
  habit: Habit,
  now: Date,
): Promise<HabitDay | null> {
  const nowIso = toIso(now);
  const todayKey = localDateKey(now);
  if (habit.windowDays !== undefined && !habit.windowDays.includes(now.getDay())) {
    return null;
  }
  if (habitCycleDay(habit.startedAt, habit.cycleDays, todayKey) === null) {
    return null;
  }
  const id = habitDayId(habit.id, todayKey);
  const existing = await tx
    .selectFrom('habit_days')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (existing !== undefined) {
    return habitDayFromRow(existing);
  }
  const day: HabitDay = {
    id,
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: null,
    habitId: habit.id,
    localDate: todayKey,
    status: 'open',
    consecutiveSkips: 0,
  };
  assertValidHabitDay(day);
  await tx.insertInto('habit_days').values({ id: day.id, ...habitDayToRow(day) }).execute();
  return day;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listHabits(
  db: NextdoDb,
  options?: { includeDeleted?: boolean },
): Promise<Habit[]> {
  let query = db.selectFrom('habits').selectAll();
  if (!options?.includeDeleted) {
    query = query.where('deleted_at', 'is', null);
  }
  const rows = await query.orderBy('created_at').execute();
  return rows.map(habitFromRow);
}

export async function listHabitDays(
  db: NextdoDb,
  options?: { habitId?: string; localDate?: string; includeDeleted?: boolean },
): Promise<HabitDay[]> {
  let query = db.selectFrom('habit_days').selectAll();
  if (options?.habitId !== undefined) query = query.where('habit_id', '=', options.habitId);
  if (options?.localDate !== undefined) query = query.where('local_date', '=', options.localDate);
  if (!options?.includeDeleted) {
    query = query.where('deleted_at', 'is', null);
  }
  const rows = await query.orderBy('local_date').orderBy('habit_id').execute();
  return rows.map(habitDayFromRow);
}

// ---------------------------------------------------------------------------
// CRUD + the start-challenge transaction
// ---------------------------------------------------------------------------

/** Plain insert (e.g. rows received/created by another device — no local
 *  seeding). Use `startHabit` for the local "start the challenge now" flow. */
export async function addHabit(db: NextdoDb, habit: Habit): Promise<Habit> {
  assertValidHabit(habit);
  await db.insertInto('habits').values({ id: habit.id, ...habitToRow(habit) }).execute();
  return habit;
}

/**
 * Full-row update. Status changes are asserted against core's
 * `HABIT_TRANSITIONS` (`completed` is terminal). A `broken → active`
 * update is the user restarting the challenge — a new cycle from today —
 * so the transaction also (re-)seeds today's HabitDay.
 */
export async function updateHabit(db: NextdoDb, habit: Habit): Promise<Habit> {
  assertValidHabit(habit);
  const previous = await loadHabitRow(db, habit.id);
  const previousStatus = habitFromRow(previous).status;
  if (previousStatus !== habit.status) {
    assertTransition(HABIT_TRANSITIONS, previousStatus as HabitStatus, habit.status, parseIso(habit.updatedAt));
  }
  const restarted = previousStatus === 'broken' && habit.status === 'active';
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable('habits')
      .set({ ...habitToRow(habit) })
      .where('id', '=', habit.id)
      .execute();
    if (restarted) {
      await seedTodayHabitDay(tx, habit, parseIso(habit.updatedAt));
    }
  });
  return habit;
}

/** Soft delete (Trash = deleted_at set, domain-model.md). The habit's day
 *  rows stay — the pool ignores days of a deleted habit. */
export async function trashHabit(db: NextdoDb, args: { id: string; now: Date }): Promise<void> {
  const nowIso = toIso(args.now);
  await loadHabitRow(db, args.id);
  await db
    .updateTable('habits')
    .set({ deleted_at: nowIso, updated_at: nowIso })
    .where('id', '=', args.id)
    .execute();
}

/**
 * Start the challenge: insert the Habit and seed today's HabitDay in ONE
 * transaction (all-or-nothing). Returns the seeded day, or null when today
 * is outside the weekday mask / challenge cycle.
 */
export async function startHabit(
  db: NextdoDb,
  habit: Habit,
  now: Date,
): Promise<{ habit: Habit; today: HabitDay | null }> {
  assertValidHabit(habit);
  if (habit.status !== 'active') {
    throw new ValidationNextdoError(
      'habit.start-not-active',
      'Only an active habit can be started (got status: ' + habit.status + ')',
    );
  }
  let today: HabitDay | null = null;
  await db.transaction().execute(async (tx) => {
    await tx.insertInto('habits').values({ id: habit.id, ...habitToRow(habit) }).execute();
    today = await seedTodayHabitDay(tx, habit, now);
  });
  return { habit, today };
}
