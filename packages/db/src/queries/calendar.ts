/**
 * CalendarAction queries (spec: domain/domain-model.md "CalendarAction").
 * Time-bound actions — hard schedule entries; an action is never both a
 * NextAction and a CalendarAction (invariant 2, one row per kind).
 *
 * Creating a CalendarAction whose `startsAt` is within the next 60 minutes
 * also creates the matching Reminder (core's `calendarActionReminderSpec`:
 * fires `startsAt − 15 min`, important intensity) in the same transaction —
 * the reminder row is the source of truth for delivery (Proposal §8).
 */
import {
  StorageNextdoError,
  assertValidCalendarAction,
  calendarActionReminderSpec,
  parseIso,
  toIso,
  ulid,
  type CalendarAction,
} from '@nextdo/core';
import { calendarActionFromRow, calendarActionToRow } from '../schema';
import type { NextdoDb } from '../types';

async function loadRow(db: NextdoDb, id: string) {
  const row = await db
    .selectFrom('calendar_actions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (row === undefined || row.deleted_at !== null) {
    throw new StorageNextdoError('calendarAction.not-found', `No live CalendarAction with id ${id}`);
  }
  return row;
}

export async function listCalendarActions(
  db: NextdoDb,
  options?: { includeDeleted?: boolean },
): Promise<CalendarAction[]> {
  let query = db.selectFrom('calendar_actions').selectAll();
  if (!options?.includeDeleted) {
    query = query.where('deleted_at', 'is', null);
  }
  const rows = await query.orderBy('starts_at').execute();
  return rows.map(calendarActionFromRow);
}

export async function addCalendarAction(
  db: NextdoDb,
  action: CalendarAction,
  now: Date,
): Promise<CalendarAction> {
  assertValidCalendarAction(action);
  // Reminder creation rule (domain-model.md "Reminder"): startsAt within
  // 60 min → fires at startsAt − 15 min, important.
  const spec = calendarActionReminderSpec(parseIso(action.startsAt), now);
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('calendar_actions')
      .values({ id: action.id, ...calendarActionToRow(action) })
      .execute();
    if (spec !== null) {
      await tx
        .insertInto('reminders')
        .values({
          id: ulid(now),
          created_at: toIso(now),
          updated_at: toIso(now),
          deleted_at: null,
          action_kind: 'calendar',
          action_id: action.id,
          fires_at: spec.firesAt,
          intensity: spec.intensity,
          state: 'scheduled',
        })
        .execute();
    }
  });
  return action;
}

/**
 * Full-row update. Note: the reminder creation rule applies to creation
 * only (domain-model.md "Reminder" table) — changing `startsAt` does not
 * re-arm a reminder in v1.
 */
export async function updateCalendarAction(
  db: NextdoDb,
  action: CalendarAction,
): Promise<CalendarAction> {
  assertValidCalendarAction(action);
  await loadRow(db, action.id);
  await db
    .updateTable('calendar_actions')
    .set({ ...calendarActionToRow(action) })
    .where('id', '=', action.id)
    .execute();
  return action;
}

/** Soft delete (Trash = deleted_at set, domain-model.md). Cancels the
 *  action's scheduled Reminders in the same transaction — the
 *  `trashAction` R8 pattern (a deleted action must never notify). */
export async function trashCalendarAction(
  db: NextdoDb,
  args: { id: string; now: Date },
): Promise<void> {
  const nowIso = toIso(args.now);
  await loadRow(db, args.id);
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable('calendar_actions')
      .set({ deleted_at: nowIso, updated_at: nowIso })
      .where('id', '=', args.id)
      .execute();
    await tx
      .updateTable('reminders')
      .set({ state: 'cancelled', updated_at: nowIso })
      .where('action_id', '=', args.id)
      .where('state', '=', 'scheduled')
      .execute();
  });
}
