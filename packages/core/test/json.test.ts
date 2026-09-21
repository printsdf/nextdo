import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deepMerge, readJson, writeJsonAtomic } from '../src/lib/json';

describe('writeJsonAtomic / readJson', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nextdo-json-'));
  });

  afterEach(async () => {
    // best-effort cleanup
    await rm(dir, { recursive: true, force: true });
  });

  it('writes and reads back', async () => {
    const file = join(dir, 'a.json');
    await writeJsonAtomic(file, { x: 1, nested: { y: [1, 2, 3] } });
    expect(await readJson(file)).toEqual({ x: 1, nested: { y: [1, 2, 3] } });
  });

  it('creates parent directories as needed', async () => {
    const file = join(dir, 'deep/nested/a.json');
    await writeJsonAtomic(file, { ok: true });
    expect(await readJson(file)).toEqual({ ok: true });
  });

  it('leaves no temp files behind', async () => {
    const file = join(dir, 'a.json');
    await writeJsonAtomic(file, { x: 1 });
    const entries = await readdir(dir);
    expect(entries.filter((name) => name.includes('.tmp-'))).toHaveLength(0);
  });

  it('returns null for a missing file', async () => {
    expect(await readJson(join(dir, 'missing.json'))).toBeNull();
  });

  it('backs up a corrupt file and returns null', async () => {
    const file = join(dir, 'bad.json');
    await writeFile(file, '{not valid json', 'utf8');
    expect(await readJson(file)).toBeNull();
    const entries = await readdir(dir);
    expect(entries).toContain('bad.json.bak');
    expect(entries).not.toContain('bad.json');
  });
});

describe('deepMerge', () => {
  it('merges nested plain objects recursively', () => {
    const base = { a: { b: 1, c: 2 }, keep: true };
    const override = { a: { b: 10, d: 3 } };
    expect(deepMerge(base, override)).toEqual({ a: { b: 10, c: 2, d: 3 }, keep: true });
  });

  it('does not mutate the base', () => {
    const base = { a: { b: 1 } };
    deepMerge(base, { a: { c: 2 } });
    expect(base).toEqual({ a: { b: 1 } });
  });

  it('replaces arrays instead of concatenating', () => {
    expect(deepMerge({ tags: ['a', 'b'] }, { tags: ['c'] })).toEqual({ tags: ['c'] });
  });

  it('lets override scalars/null win', () => {
    expect(deepMerge({ a: 1, b: 'x' }, { a: 2, b: null })).toEqual({ a: 2, b: null });
  });

  it('returns the override when types differ', () => {
    expect(deepMerge({ a: { b: 1 } }, { a: 'scalar' })).toEqual({ a: 'scalar' });
    expect(deepMerge('scalar', { a: 1 })).toEqual({ a: 1 });
  });
});
