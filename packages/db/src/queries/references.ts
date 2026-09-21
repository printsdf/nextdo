/**
 * ReferenceItem queries (spec: domain/domain-model.md "ReferenceItem").
 * External material — v1 = links only (title + url + note).
 */
import { StorageNextdoError, assertValidReferenceItem, toIso, type ReferenceItem } from '@nextdo/core';
import { referenceItemFromRow, referenceItemToRow } from '../schema';
import type { NextdoDb } from '../types';

async function loadRow(db: NextdoDb, id: string) {
  const row = await db
    .selectFrom('reference_items')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (row === undefined || row.deleted_at !== null) {
    throw new StorageNextdoError('referenceItem.not-found', `No live ReferenceItem with id ${id}`);
  }
  return row;
}

export async function listReferenceItems(
  db: NextdoDb,
  options?: { includeDeleted?: boolean },
): Promise<ReferenceItem[]> {
  let query = db.selectFrom('reference_items').selectAll();
  if (!options?.includeDeleted) {
    query = query.where('deleted_at', 'is', null);
  }
  const rows = await query.orderBy('created_at').execute();
  return rows.map(referenceItemFromRow);
}

export async function addReferenceItem(db: NextdoDb, item: ReferenceItem): Promise<ReferenceItem> {
  assertValidReferenceItem(item);
  await db
    .insertInto('reference_items')
    .values({ id: item.id, ...referenceItemToRow(item) })
    .execute();
  return item;
}

export async function updateReferenceItem(
  db: NextdoDb,
  item: ReferenceItem,
): Promise<ReferenceItem> {
  assertValidReferenceItem(item);
  await loadRow(db, item.id);
  await db
    .updateTable('reference_items')
    .set({ ...referenceItemToRow(item) })
    .where('id', '=', item.id)
    .execute();
  return item;
}

/** Soft delete (Trash = deleted_at set, domain-model.md). */
export async function trashReferenceItem(
  db: NextdoDb,
  args: { id: string; now: Date },
): Promise<void> {
  const nowIso = toIso(args.now);
  await loadRow(db, args.id);
  await db
    .updateTable('reference_items')
    .set({ deleted_at: nowIso, updated_at: nowIso })
    .where('id', '=', args.id)
    .execute();
}
