/**
 * Node-only JSON file I/O (import via `@nextdo/core/json`).
 *
 * NOT part of the isomorphic barrel: this module imports node:fs and
 * must never be pulled into the Expo bundle.
 */
import { promises as fsp } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

/**
 * Atomically write JSON: write to a temp file in the same directory,
 * fsync, then rename over the target. Parent directories are created
 * as needed.
 */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await fsp.mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${randomUUID()}`;
  const handle = await fsp.open(tmpPath, 'w');
  try {
    await handle.writeFile(JSON.stringify(data, null, 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(tmpPath, filePath);
}

/**
 * Read JSON. Returns null when the file does not exist. When the file
 * exists but is corrupt, it is moved to `${filePath}.bak` (overwriting
 * any previous backup) and null is returned.
 */
export async function readJson<T>(filePath: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await fsp.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    await fsp.rename(filePath, `${filePath}.bak`).catch(() => {
      /* best effort — surface via the caller's null result */
    });
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep merge `override` onto `base`. Plain objects merge recursively;
 * arrays and scalars are replaced (not concatenated); `null` in
 * override overwrites. The base is never mutated.
 */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return override as T;
  const baseRecord = base as Record<string, unknown>;
  const out: Record<string, unknown> = { ...baseRecord };
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in baseRecord ? deepMerge(baseRecord[key], value) : value;
  }
  return out as T;
}
