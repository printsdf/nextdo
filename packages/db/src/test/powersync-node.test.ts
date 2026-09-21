/**
 * Smoke test: prove the web PowerSync SDK runs under plain Node via the
 * node:sqlite adapter before any real schema/query code is built on top.
 *
 * Exercises, end to end:
 * 1. `new PowerSyncDatabase({ schema, opened })` + `init()` with the FULL
 *    AppSchema (internal table creation, schema view application for all 14
 *    MVP tables + indexes, all through our adapter's locks);
 * 2. a Kysely INSERT of an InboxItem against the SDK-managed schema view
 *    (round-tripped through the snake_case ↔ camelCase mappers);
 * 3. a Kysely SELECT reading the row back;
 * 4. a raw `writeTransaction` (BEGIN IMMEDIATE / COMMIT via the adapter);
 * 5. clean close.
 */
import { AppSchema, inboxItemFromRow, inboxItemToRow, type Database } from '../schema';

import { createNodeTestDatabase } from './powersync-node';

describe('node:sqlite PowerSync adapter', () => {
  it('inits the full AppSchema, writes and reads through Kysely, and closes', async () => {
    const { powersync, kysely, close } = await createNodeTestDatabase<Database>(AppSchema);

    const now = '2026-09-21T00:00:00.000Z';
    const item = {
      id: '01TESTAAAAAAAAAAAAAAAAA',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      title: 'first capture',
      capturedAt: now,
    };
    await kysely
      .insertInto('inbox_items')
      .values({ id: item.id, ...inboxItemToRow(item) })
      .execute();

    const rows = await kysely
      .selectFrom('inbox_items')
      .selectAll()
      .orderBy('captured_at')
      .execute();
    expect(rows).toHaveLength(1);
    expect(inboxItemFromRow(rows[0]!)).toEqual(item);

    // Raw transaction path (used by the canonical mutation transactions).
    await powersync.writeTransaction(async (db) => {
      await db.execute('UPDATE inbox_items SET deleted_at = ? WHERE id = ?', [now, item.id]);
    });
    const updatedRow = await kysely
      .selectFrom('inbox_items')
      .selectAll()
      .where('id', '=', item.id)
      .executeTakeFirst();
    expect(inboxItemFromRow(updatedRow!).deletedAt).toBe(now);

    await close();
  }, 20_000);
});
