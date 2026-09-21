/**
 * Action queries + the canonical mutation transactions
 * (spec: domain/domain-model.md "The Complete Transaction",
 * next-action-engine.md "Skip & Re-clarify").
 *
 * Every transaction is atomic (one local transaction per user intent) and
 * runs core's legality assertions before writing.
 */
import {
  ACTION_TRANSITIONS,
  assertTransition,
  assertValidNextAction,
  localDateKey,
  parseIso,
  snoozeReminderSpec,
  StorageNextdoError,
  toIso,
  ulid,
  type ActionStatus,
  type NextAction,
} from '@nextdo/core';
import { nextActionFromRow, nextActionToRow, type Database } from '../schema';
import type { ActionKind, NextdoDb } from '../types';

const ACTION_TABLES: Record<ActionKind, 'next_actions' | 'calendar_actions' | 'habit_days'> = {
  next: 'next_actions',
  calendar: 'calendar_actions',
  habit: 'habit_days',
};

const DAY_MS = 86_400_000;

/**
 * Load a live (non-deleted) action row for any of the three action kinds.
 * Shared by the mutation transactions here and by `reclarifyAction`
 * (queries/inbox.ts).
 */
export async function loadActionRow(
  db: NextdoDb,
  actionKind: ActionKind,
  actionId: string,
) {
  const table = ACTION_TABLES[actionKind];
  const row = await db
    .selectFrom(table)
    .selectAll()
    .where('id', '=', actionId)
    .executeTakeFirst();
  if (row === undefined || row.deleted_at !== null) {
    throw new StorageNextdoError(
      'action.not-found',
      `No live ${actionKind} action with id ${actionId}`,
    );
  }
  return row;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listNextActions(
  db: NextdoDb,
  options?: { includeDeleted?: boolean },
): Promise<NextAction[]> {
  let query = db.selectFrom('next_actions').selectAll();
  if (!options?.includeDeleted) {
    query = query.where('deleted_at', 'is', null);
  }
  const rows = await query.orderBy('created_at').execute();
  return rows.map(nextActionFromRow);
}

// ---------------------------------------------------------------------------
// NextAction CRUD
// ---------------------------------------------------------------------------

export async function addNextAction(db: NextdoDb, action: NextAction): Promise<NextAction> {
  assertValidNextAction(action);
  await db
    .insertInto('next_actions')
    .values({ id: action.id, ...nextActionToRow(action) })
    .execute();
  return action;
}

/**
 * Full-row update. Resets `consecutiveSkips` to 0 when the user redefined
 * the action (title or estimate changed) — engine spec "Skip & Re-clarify".
 */
export async function updateNextAction(
  db: NextdoDb,
  action: NextAction,
): Promise<NextAction> {
  assertValidNextAction(action);
  const previous = await loadActionRow(db, 'next', action.id);
  const previousAction = nextActionFromRow(previous as Database['next_actions']);
  const redefined =
    previousAction.title !== action.title || previousAction.estMinutes !== action.estMinutes;
  const next = redefined
    ? { ...action, consecutiveSkips: 0, lastSkippedAt: undefined }
    : action;
  await db
    .updateTable('next_actions')
    .set({ ...nextActionToRow(next), updated_at: next.updatedAt })
    .where('id', '=', action.id)
    .execute();
  return next;
}

// ---------------------------------------------------------------------------
// Canonical transactions (all three action kinds)
// ---------------------------------------------------------------------------

/**
 * "The Complete Transaction" (domain-model.md) — exactly these five steps,
 * one local transaction:
 * 1. assertTransition(open → done);
 * 2. status = "done", clear snoozedUntil, reset consecutiveSkips = 0;
 * 3. insert CompletionRecord (estMinutes copied at completion; the
 *    `do_now` path lives in inbox.applyClarify);
 * 4. cancel any scheduled Reminder pointing at the action;
 * 5. habit only: the day row IS the action (step 2 marks it done); if it
 *    was the last day of the cycle, set the habit status = "completed".
 *
 * Project action coverage is NOT updated here — it is derived on query.
 */
export async function completeAction(
  db: NextdoDb,
  args: { actionKind: ActionKind; actionId: string; now: Date },
): Promise<void> {
  const { actionKind, actionId, now } = args;
  const nowIso = toIso(now);
  const table = ACTION_TABLES[actionKind];
  const row = await loadActionRow(db, actionKind, actionId);

  // Step 1.
  assertTransition(ACTION_TRANSITIONS, row.status as ActionStatus, 'done', now);

  // Habit context needed for step 5 (and for the CompletionRecord estimate).
  let habitId: string | null = null;
  let habitEstMinutes: number | null = null;
  let lastCycleDayKey: string | null = null;
  if (actionKind === 'habit') {
    const habit = await db
      .selectFrom('habits')
      .selectAll()
      .where('id', '=', row.habit_id as string)
      .executeTakeFirst();
    if (habit !== undefined && habit.deleted_at === null) {
      habitId = habit.id;
      habitEstMinutes = habit.est_minutes;
      const startedAtMs = parseIso(habit.started_at as string).getTime();
      lastCycleDayKey = localDateKey(
        new Date(startedAtMs + ((habit.cycle_days as number) - 1) * DAY_MS),
      );
    }
  }
  const estMinutes = actionKind === 'habit' ? habitEstMinutes : row.est_minutes;

  await db.transaction().execute(async (tx) => {
    // Step 2.
    await tx
      .updateTable(table)
      .set({
        status: 'done',
        snoozed_until: null,
        consecutive_skips: 0,
        updated_at: nowIso,
      })
      .where('id', '=', actionId)
      .execute();
    // Step 3.
    await tx
      .insertInto('completion_records')
      .values({
        id: ulid(now),
        created_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
        action_kind: actionKind,
        action_id: actionId,
        completed_at: nowIso,
        est_minutes: estMinutes,
      })
      .execute();
    // Step 4.
    await tx
      .updateTable('reminders')
      .set({ state: 'cancelled', updated_at: nowIso })
      .where('action_id', '=', actionId)
      .where('state', '=', 'scheduled')
      .execute();
    // Step 5 (habit only — the day row was already set to done in step 2).
    if (
      actionKind === 'habit' &&
      habitId !== null &&
      lastCycleDayKey !== null &&
      row.local_date === lastCycleDayKey
    ) {
      await tx
        .updateTable('habits')
        .set({ status: 'completed', updated_at: nowIso })
        .where('id', '=', habitId)
        .execute();
    }
  });
}

/** "换一个": consecutiveSkips += 1, lastSkippedAt = now (no reminder is ever
 *  created from skips — domain-model.md Reminder rules). */
export async function skipAction(
  db: NextdoDb,
  args: { actionKind: ActionKind; actionId: string; now: Date },
): Promise<void> {
  const { actionKind, actionId, now } = args;
  const nowIso = toIso(now);
  const table = ACTION_TABLES[actionKind];
  const row = await loadActionRow(db, actionKind, actionId);
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable(table)
      .set({
        consecutive_skips: (row.consecutive_skips ?? 0) + 1,
        last_skipped_at: nowIso,
        updated_at: nowIso,
      })
      .where('id', '=', actionId)
      .execute();
  });
}

/**
 * Snooze: sets snoozedUntil + lastSnoozedAt, resets consecutiveSkips, and
 * creates the matching Reminder (domain-model.md: "Snooze is a DB-only
 * state"; reminder row = source of truth for delivery).
 */
export async function snoozeAction(
  db: NextdoDb,
  args: { actionKind: ActionKind; actionId: string; snoozedUntil: Date; now: Date },
): Promise<void> {
  const { actionKind, actionId, snoozedUntil, now } = args;
  const nowIso = toIso(now);
  const snoozedUntilIso = toIso(snoozedUntil);
  const table = ACTION_TABLES[actionKind];
  await loadActionRow(db, actionKind, actionId);
  const reminder = snoozeReminderSpec(snoozedUntil);
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable(table)
      .set({
        snoozed_until: snoozedUntilIso,
        last_snoozed_at: nowIso,
        consecutive_skips: 0,
        updated_at: nowIso,
      })
      .where('id', '=', actionId)
      .execute();
    await tx
      .insertInto('reminders')
      .values({
        id: ulid(now),
        created_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
        action_kind: actionKind,
        action_id: actionId,
        fires_at: reminder.firesAt,
        intensity: reminder.intensity,
        state: 'scheduled',
      })
      .execute();
  });
}

/** Soft delete (Trash = deleted_at set, domain-model.md). */
export async function trashAction(
  db: NextdoDb,
  args: { actionKind: ActionKind; actionId: string; now: Date },
): Promise<void> {
  const { actionKind, actionId, now } = args;
  const nowIso = toIso(now);
  const table = ACTION_TABLES[actionKind];
  await loadActionRow(db, actionKind, actionId);
  await db
    .updateTable(table)
    .set({ deleted_at: nowIso, updated_at: nowIso })
    .where('id', '=', actionId)
    .execute();
}
