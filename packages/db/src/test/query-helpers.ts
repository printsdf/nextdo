/**
 * Shared helpers for the query-layer tests: every test gets a fresh
 * in-memory PowerSync database (web SDK on node:sqlite); `seed` loads the
 * canonical demo dataset (test/fixtures.ts) at `now` (default FIXTURE_NOW).
 */
import { AppSchema, type Database } from '../schema';
import type { NextdoDb } from '../types';
import { FIXTURE_NOW, seedFixtures } from './fixtures';
import { createNodeTestDatabase } from './powersync-node';

export interface TestDb {
  db: NextdoDb;
  close: () => Promise<void>;
}

/** Open a fresh in-memory DB; `seed` inserts the canonical fixtures. */
export async function openTestDb(seed = false, now: Date = FIXTURE_NOW): Promise<TestDb> {
  const { kysely, close } = await createNodeTestDatabase<Database>(AppSchema);
  if (seed) {
    await seedFixtures(kysely, now);
  }
  return { db: kysely, close };
}
