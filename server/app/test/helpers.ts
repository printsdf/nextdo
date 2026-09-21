/**
 * Shared test fixture: an in-memory mock of the DbPool/DbClient surface
 * (db.ts) — NO live Postgres. Records every statement (text + values) so
 * tests assert the REAL apply decisions (which SQL ran, with which
 * parameters), not just status codes.
 */
import type { DbClient, DbPool } from '../src/db.js';

export interface RecordedQuery {
  text: string;
  values: readonly unknown[];
}

export interface MockPool {
  pool: DbPool;
  queries: RecordedQuery[];
}

export interface MockPoolOptions {
  /** Make the next N `query` calls throw (a transient DB failure). */
  failNextQueries?: number;
}

export function createMockPool(options?: MockPoolOptions): MockPool {
  const queries: RecordedQuery[] = [];
  let failures = options?.failNextQueries ?? 0;

  const client: DbClient = {
    async query(text, values) {
      queries.push({ text, values: values ?? [] });
      if (failures > 0) {
        failures -= 1;
        throw new Error('mock transient pg failure');
      }
      return { rows: [] };
    },
    release() {
      // no-op
    },
  };

  const pool: DbPool = {
    connect: async () => client,
    query: (text, values) => client.query(text, values),
    end: async () => {
      // no-op
    },
  };

  return { pool, queries };
}

/** Fixed owner token / JWT secret shared by the endpoint tests. */
export const OWNER_TOKEN = 'owner-token-test-abc123';
export const JWT_SECRET = Buffer.from('unit-test-jwt-secret-0123456789', 'utf8').toString(
  'base64url',
);

/** Fixed clock (convention: no tests assert on real time). */
export const NOW = new Date('2026-09-21T12:00:00.000Z');
export const NOW_ISO = '2026-09-21T12:00:00.000Z';
