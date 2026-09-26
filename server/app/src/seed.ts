/**
 * Default-context seeding — the SINGLE authoritative writer of the five
 * spec defaults (domain-model.md "Context": home, office, computer, phone,
 * outside).
 *
 * WHY SERVER-SIDE (not client-side): client seeding was racy — two fresh
 * client DBs could both see an empty remote, both seed, and upload two sets
 * of defaults, which then sync back to EVERY client as duplicate context
 * tags. The server process is the single writer, so seeding here cannot
 * race. The client no longer seeds (see apps/mobile/app/_layout.tsx).
 *
 * @nextdo/server is ISOLATED (Rule 1: no monorepo imports), so `ulid` is the
 * local standalone copy (src/ulid.ts) — the ids feed the same `id TEXT`
 * primary keys the client mints.
 */
import { withTransaction, type DbPool } from './db.js';
import { ulid } from './ulid.js';

/** The spec's seeded defaults (domain-model.md "Context"), in display order. */
export const DEFAULT_CONTEXT_NAMES = ['home', 'office', 'computer', 'phone', 'outside'] as const;

/**
 * Seed the default contexts on a FRESH database. When the `contexts` table
 * holds NO rows at all — live OR soft-deleted — insert the five spec
 * defaults (ulid(now) ids, now timestamps) and return the inserted count.
 * ANY existing row is a no-op (returns 0): a user who deleted all the seeds
 * is not re-seeded (their intent is respected — their soft-deleted rows
 * still count as "existing"), and existing user contexts are untouched.
 * Idempotent across server restarts.
 *
 * Runs in ONE transaction (the check-and-insert is atomic; all five inserts
 * commit together). Called at process start, before the HTTP server accepts
 * /upload, so it is the only writer at that moment — but the transaction
 * keeps the invariant safe regardless.
 */
export async function seedDefaultContexts(pool: DbPool, now: Date = new Date()): Promise<number> {
  return withTransaction(pool, async (client) => {
    const check = await client.query('SELECT 1 FROM contexts LIMIT 1');
    if (check.rows.length > 0) {
      return 0;
    }
    const nowIso = now.toISOString();
    for (const name of DEFAULT_CONTEXT_NAMES) {
      await client.query(
        'INSERT INTO contexts (id, created_at, updated_at, deleted_at, name) VALUES ($1, $2, $3, $4, $5)',
        [ulid(now), nowIso, nowIso, null, name],
      );
    }
    return DEFAULT_CONTEXT_NAMES.length;
  });
}
