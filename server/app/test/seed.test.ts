/**
 * seedDefaultContexts (server entry seed) — the single-writer seeder of the
 * five spec default contexts. Asserts the REAL SQL decisions (which statements
 * ran, with which parameters), not just the return count.
 */
import { DEFAULT_CONTEXT_NAMES, seedDefaultContexts } from '../src/seed.js';
import { createMockPool, NOW, NOW_ISO } from './helpers.js';

describe('seedDefaultContexts (server entry seed)', () => {
  it('seeds the five defaults with ulid ids + now timestamps when the table is empty', async () => {
    const { pool, queries } = createMockPool();
    const count = await seedDefaultContexts(pool, NOW);

    expect(count).toBe(5);

    // After BEGIN, the first statement is the "any row exists?" check.
    expect(queries[1]?.text).toBe('SELECT 1 FROM contexts LIMIT 1');

    const inserts = queries.filter((q) => q.text.startsWith('INSERT INTO contexts'));
    expect(inserts).toHaveLength(5);
    // Inserted in the spec's display order, with the spec names.
    expect(inserts.map((q) => q.values[4])).toEqual([...DEFAULT_CONTEXT_NAMES]);

    for (const ins of inserts) {
      const [id, createdAt, updatedAt, deletedAt, name] = ins.values as [
        string,
        string,
        string,
        null,
        string,
      ];
      // 26-char Crockford base32 (no I, L, O, U).
      expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(createdAt).toBe(NOW_ISO);
      expect(updatedAt).toBe(NOW_ISO);
      expect(deletedAt).toBeNull();
      expect(typeof name).toBe('string');
    }

    // Wrapped in a transaction (all five inserts commit together).
    expect(queries.some((q) => q.text === 'BEGIN')).toBe(true);
    expect(queries.some((q) => q.text === 'COMMIT')).toBe(true);
  });

  it('is a no-op when ANY row exists (live or soft-deleted — user intent is respected)', async () => {
    const { pool, queries } = createMockPool({ selectRows: [{ '?column?': 1 }] });
    const count = await seedDefaultContexts(pool, NOW);

    expect(count).toBe(0);
    expect(queries.filter((q) => q.text.startsWith('INSERT'))).toHaveLength(0);
    // The check still ran (it is what detected the existing row) — after BEGIN.
    expect(queries[1]?.text).toBe('SELECT 1 FROM contexts LIMIT 1');
  });

  it('rolls back (no COMMIT) on a transient DB failure — the seed is atomic', async () => {
    // The first statement (BEGIN) fails → withTransaction rolls back and
    // rethrows; nothing is committed (no partial seed).
    const { pool, queries } = createMockPool({ failNextQueries: 1 });
    await expect(seedDefaultContexts(pool, NOW)).rejects.toThrow('mock transient pg failure');
    expect(queries.some((q) => q.text === 'ROLLBACK')).toBe(true);
    expect(queries.some((q) => q.text === 'COMMIT')).toBe(false);
  });
});
