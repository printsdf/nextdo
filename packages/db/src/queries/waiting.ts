/**
 * WaitingForItem queries (spec: domain/domain-model.md "WaitingForItem").
 * Delegated or blocked on someone/something else — invariant 3: these items
 * never enter the engine pool (the pool query does not select them).
 */
import { StorageNextdoError, assertValidWaitingForItem, toIso, type WaitingForItem } from '@nextdo/core';
import { waitingForItemFromRow, waitingForItemToRow } from '../schema';
import type { NextdoDb } from '../types';

async function loadRow(db: NextdoDb, id: string) {
  const row = await db
    .selectFrom('waiting_for_items')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (row === undefined || row.deleted_at !== null) {
    throw new StorageNextdoError('waitingForItem.not-found', `No live WaitingForItem with id ${id}`);
  }
  return row;
}

export async function listWaitingForItems(
  db: NextdoDb,
  options?: { includeDeleted?: boolean },
): Promise<WaitingForItem[]> {
  let query = db.selectFrom('waiting_for_items').selectAll();
  if (!options?.includeDeleted) {
    query = query.where('deleted_at', 'is', null);
  }
  const rows = await query.orderBy('created_at').execute();
  return rows.map(waitingForItemFromRow);
}

export async function addWaitingForItem(
  db: NextdoDb,
  item: WaitingForItem,
): Promise<WaitingForItem> {
  assertValidWaitingForItem(item);
  await db
    .insertInto('waiting_for_items')
    .values({ id: item.id, ...waitingForItemToRow(item) })
    .execute();
  return item;
}

export async function updateWaitingForItem(
  db: NextdoDb,
  item: WaitingForItem,
): Promise<WaitingForItem> {
  assertValidWaitingForItem(item);
  await loadRow(db, item.id);
  await db
    .updateTable('waiting_for_items')
    .set({ ...waitingForItemToRow(item) })
    .where('id', '=', item.id)
    .execute();
  return item;
}

/** Soft delete (Trash = deleted_at set, domain-model.md). */
export async function trashWaitingForItem(
  db: NextdoDb,
  args: { id: string; now: Date },
): Promise<void> {
  const nowIso = toIso(args.now);
  await loadRow(db, args.id);
  await db
    .updateTable('waiting_for_items')
    .set({ deleted_at: nowIso, updated_at: nowIso })
    .where('id', '=', args.id)
    .execute();
}
