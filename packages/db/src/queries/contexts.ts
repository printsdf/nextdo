/**
 * Context queries (spec: domain/domain-model.md "Context").
 * Named execution environments — seeded defaults (home, office, computer,
 * phone, outside); the user's CURRENT environments are a UI-layer
 * declaration (EngineContext.contextIds), not stored here beyond each
 * action's own contextIds.
 */
import { StorageNextdoError, assertValidContext, toIso, ulid, type Context } from '@nextdo/core';
import { contextFromRow, contextToRow } from '../schema';
import type { NextdoDb } from '../types';

/** The spec's seeded defaults (domain-model.md "Context"), in display order. */
const DEFAULT_CONTEXT_NAMES = ['home', 'office', 'computer', 'phone', 'outside'] as const;

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

/**
 * Seed the default contexts on a FRESH database: when the `contexts` table
 * holds NO rows at all — live or soft-deleted — insert the five spec
 * defaults (ulid(now) ids, now timestamps) and return the inserted count.
 * ANY existing row is a no-op (returns 0): a user who deleted all the seeds
 * is not re-seeded (their intent is respected — their soft-deleted rows
 * still count as "existing"), and existing user contexts are untouched.
 * Idempotent.
 *
 * PRODUCTION SEEDING IS SERVER-SIDE (server/app/src/seed.ts, single-writer):
 * the app root layout no longer calls this. Client-side seeding was racy —
 * two fresh client DBs could both seed and upload two sets of defaults,
 * which sync back to every client as duplicate context tags. This function
 * is retained for local/offline seeding and the db query tests.
 */
export async function seedDefaultContexts(db: NextdoDb, now: Date): Promise<number> {
  const anyRow = await db
    .selectFrom('contexts')
    .select('id')
    .executeTakeFirst();
  if (anyRow !== undefined) {
    return 0;
  }
  const nowIso = toIso(now);
  for (const name of DEFAULT_CONTEXT_NAMES) {
    const context: Context = {
      id: ulid(now),
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
      name,
    };
    await db.insertInto('contexts').values({ id: context.id, ...contextToRow(context) }).execute();
  }
  return DEFAULT_CONTEXT_NAMES.length;
}
