/**
 * Owner-token bootstrap + one-time claim (prod-deploy R7, claim task
 * 09-28). The v1 owner token is OPTIONAL at the env level. Startup
 * resolution order:
 *
 *   1. `NEXTDO_OWNER_TOKEN` (explicit, non-empty) → used as-is; nothing
 *      is written and nothing is printed (the pre-R7 flow, unchanged).
 *   2. A non-empty file at `NEXTDO_OWNER_TOKEN_FILE` (default
 *      `data/owner-token`) → reused SILENTLY. Container rebuilds and
 *      restarts never rotate the token.
 *   3. Neither → UNCLAIMED: `{ token: null, source: 'unclaimed' }`.
 *      Nothing is generated, written, or printed at boot (R7's first-run
 *      banner is GONE) — the first device to `POST /claim` mints the
 *      token (claimOwnerToken below). The token no longer reaches ANY
 *      log line; the claim's 200 body is its only display path.
 *
 * The file lives on the deploy host (the production compose binds
 * `server/deploy/data/` to `/app/data`): the same trust domain as `.env`,
 * which already holds POSTGRES_PASSWORD + JWT_SECRET next door. Rotating
 * the token = delete the file (or set the env var) and restart — every
 * device must re-enter it.
 *
 * Single-writer by design: one api service per stack, no locking needed
 * (the claim inherits the assumption).
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Default persistence location (process-cwd relative; compose binds
 *  `server/deploy/data/` over it in production). */
const DEFAULT_TOKEN_FILE = 'data/owner-token';

export interface OwnerTokenEnv {
  NEXTDO_OWNER_TOKEN?: string;
  NEXTDO_OWNER_TOKEN_FILE?: string;
}

export interface OwnerTokenResolution {
  /** null = unclaimed at boot — no token exists yet (the claim mints it). */
  token: string | null;
  /** `env` = explicit variable · `file` = persisted · `unclaimed` = neither. */
  source: 'env' | 'file' | 'unclaimed';
}

/** The outcome of a `POST /claim` (claim R1): a one-time mint, or the
 *  409 reason. */
export type ClaimResult =
  | { claimed: true; token: string }
  | { claimed: false; reason: 'file' | 'explicit' };

/**
 * Resolve the owner token for this boot. NO side effects: the unclaimed
 * branch neither writes a file nor prints anything.
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
    // Silent reuse — no regeneration (restart ≠ first run).
    return { token: existing, source: 'file' };
  }
  return { token: null, source: 'unclaimed' };
}

/**
 * The one-time claim (claim R1): the first device to `POST /claim` mints
 * the token. Order:
 *   1. an explicit env token is NEVER served by the claim (`'explicit'`);
 *   2. a persisted file wins (`'file'` — already claimed, or any boot
 *      after a claim; the file is the durable "claim closed" marker);
 *   3. otherwise generate `randomBytes(32).toString('hex')` (64 hex
 *      chars) and persist it — the write closes the claim for every
 *      later call, including after restarts.
 *
 * The token is returned to the CALLER (the /claim route puts it in the
 * one 200 body); it is never logged.
 */
export async function claimOwnerToken(env: OwnerTokenEnv = process.env): Promise<ClaimResult> {
  const fromEnv = env.NEXTDO_OWNER_TOKEN;
  if (fromEnv !== undefined && fromEnv !== '') {
    return { claimed: false, reason: 'explicit' };
  }
  const file = env.NEXTDO_OWNER_TOKEN_FILE ?? DEFAULT_TOKEN_FILE;
  const existing = await readExistingToken(file);
  if (existing !== null) {
    return { claimed: false, reason: 'file' };
  }
  const token = randomBytes(32).toString('hex');
  await persistToken(file, token);
  return { claimed: true, token };
}

/** The persisted token, or null when the file is missing OR effectively
 *  empty (a whitespace-only file is a failed claim — treat as unclaimed). */
async function readExistingToken(file: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return null;
    }
    // A present-but-unreadable file is a real problem (permissions) — fail
    // closed instead of silently minting a second token.
    throw error;
  }
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

async function persistToken(file: string, token: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${token}\n`, 'utf8');
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
