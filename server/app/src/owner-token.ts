/**
 * Owner-token bootstrap (prod-deploy R7) — the v1 owner token is OPTIONAL
 * at the env level. Resolution order at startup:
 *
 *   1. `NEXTDO_OWNER_TOKEN` (explicit, non-empty) → used as-is; nothing is
 *      written and nothing is printed (the pre-R7 flow, unchanged).
 *   2. A non-empty file at `NEXTDO_OWNER_TOKEN_FILE` (default
 *      `data/owner-token`) → reused SILENTLY. Container rebuilds and
 *      restarts never rotate the token and never re-print it.
 *   3. Neither → generate `randomBytes(32).toString('hex')` (64 hex
 *      chars), persist it to the file, and print it ONCE in a prominent
 *      startup banner. The log line is the token's ONLY display path —
 *      the API and the client UI never echo it (the Settings tab is
 *      input-only; see logger.ts for the one sanctioned exception to the
 *      "never log secrets" rule).
 *
 * The file lives on the deploy host (the production compose binds
 * `server/deploy/data/` to `/app/data`): the same trust domain as `.env`,
 * which already holds POSTGRES_PASSWORD + JWT_SECRET next door. Rotating
 * the token = delete the file (or set the env var) and restart — every
 * device must re-enter it.
 *
 * Single-writer by design: one api service per stack, no locking needed.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';

/** Default persistence location (process-cwd relative; compose binds
 *  `server/deploy/data/` over it in production). */
const DEFAULT_TOKEN_FILE = 'data/owner-token';

const BANNER_LINE = '='.repeat(70);

export interface OwnerTokenEnv {
  NEXTDO_OWNER_TOKEN?: string;
  NEXTDO_OWNER_TOKEN_FILE?: string;
}

export interface OwnerTokenResolution {
  token: string;
  /** `env` = explicit variable · `file` = persisted · `generated` = first
   *  run (the banner was printed). */
  source: 'env' | 'file' | 'generated';
}

/**
 * Resolve the owner token for this boot. The ONLY side effect is the
 * first-run file write (+ the one-time banner log).
 */
export async function resolveOwnerToken(
  env: OwnerTokenEnv = process.env,
): Promise<OwnerTokenResolution> {
  const fromEnv = env.NEXTDO_OWNER_TOKEN;
  if (fromEnv !== undefined && fromEnv !== '') {
    return { token: fromEnv, source: 'env' };
  }
  const file = env.NEXTDO_OWNER_TOKEN_FILE ?? DEFAULT_TOKEN_FILE;
  const existing = await readExistingToken(file);
  if (existing !== null) {
    // Silent reuse — no banner, no regeneration (restart ≠ first run).
    return { token: existing, source: 'file' };
  }
  const token = randomBytes(32).toString('hex');
  await persistToken(file, token);
  printFirstRunBanner(token, file);
  return { token, source: 'generated' };
}

/** The persisted token, or null when the file is missing OR effectively
 *  empty (a whitespace-only file is a failed first run — regenerate). */
async function readExistingToken(file: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return null;
    }
    // A present-but-unreadable file is a real problem (permissions) — fail
    // closed instead of silently generating a second token.
    throw error;
  }
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

async function persistToken(file: string, token: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${token}\n`, 'utf8');
}

/** The one-time display path (R7 "第一次可查看"): printed ONLY on the
 *  generation branch, never on file reuse. */
function printFirstRunBanner(token: string, file: string): void {
  logger.info(BANNER_LINE);
  logger.info('FIRST RUN — an owner token was AUTO-GENERATED. It is shown ONCE:');
  logger.info(`  ${token}`);
  logger.info('');
  logger.info('Enter it in each device (Settings tab → Cloud sync). It will NOT');
  logger.info('be shown again. It is also persisted to the file below (server-side');
  logger.info('only — the API and the client UI never return it):');
  logger.info(`  ${file}`);
  logger.info('');
  logger.info('Tip: set NEXTDO_OWNER_TOKEN in server/deploy/.env to make it explicit.');
  logger.info(BANNER_LINE);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
