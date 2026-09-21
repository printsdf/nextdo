/**
 * Context queries (spec: domain/domain-model.md "Context").
 * Named execution environments — seeded defaults (home, office, computer,
 * phone, outside); the user's CURRENT environments are a UI-layer
 * declaration (EngineContext.contextIds), not stored here beyond each
 * action's own contextIds.
 */
import { StorageNextdoError, assertValidContext, toIso, type Context } from '@nextdo/core';
import { contextFromRow, contextToRow } from '../schema';
import type { NextdoDb } from '../types';

async function loadRow(db: NextdoDb, id: string) {
  const row = await db.selectFrom('contexts').selectAll().where('id', '=', id).executeTakeFirst();
  if (row === undefined || row.deleted_at !== null) {
    throw new StorageNextdoError('context.not-found', `No live Context with id ${id}`);
  }
  return row;
}

export async function listContexts(
  db: NextdoDb,
  options?: { includeDeleted?: boolean },
): Promise<Context[]> {
  let query = db.selectFrom('contexts').selectAll();
  if (!options?.includeDeleted) {
    query = query.where('deleted_at', 'is', null);
  }
  const rows = await query.orderBy('name').execute();
  return rows.map(contextFromRow);
}

export async function addContext(db: NextdoDb, context: Context): Promise<Context> {
  assertValidContext(context);
  await db.insertInto('contexts').values({ id: context.id, ...contextToRow(context) }).execute();
  return context;
}

export async function updateContext(db: NextdoDb, context: Context): Promise<Context> {
  assertValidContext(context);
  await loadRow(db, context.id);
  await db
    .updateTable('contexts')
    .set({ ...contextToRow(context) })
    .where('id', '=', context.id)
    .execute();
  return context;
}

/** Soft delete (Trash = deleted_at set, domain-model.md). */
export async function trashContext(db: NextdoDb, args: { id: string; now: Date }): Promise<void> {
  const nowIso = toIso(args.now);
  await loadRow(db, args.id);
  await db
    .updateTable('contexts')
    .set({ deleted_at: nowIso, updated_at: nowIso })
    .where('id', '=', args.id)
    .execute();
}
