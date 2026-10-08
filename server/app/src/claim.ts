/**
 * Server claim state & management — supports one-time setup / pairing.
 *
 * When a deployment is started without an explicit `NEXTDO_OWNER_TOKEN`,
 * the server enters an "unclaimed" state where:
 * 1. `GET /claim/status` returns `{ claimed: false }`
 * 2. `POST /claim` atomically claims the server by generating or accepting
 *    an owner token and persisting it to `system_settings`.
 * 3. Once claimed, any subsequent `POST /claim` returns 409 Conflict.
 *
 * If `NEXTDO_OWNER_TOKEN` is set, the server is permanently claimed from boot.
 */
import { randomBytes } from 'node:crypto';
import type { DbPool } from './db.js';

export const SYSTEM_SETTINGS_TABLE = 'system_settings';
export const OWNER_TOKEN_KEY = 'owner_token';

export interface ClaimState {
  isClaimed(): boolean;
  getOwnerToken(): string | null;
  claim(requestedToken?: string): Promise<
    | { ok: true; ownerToken: string }
    | { ok: false; code: 'claim.already_claimed' }
  >;
}

/** Ensure the system_settings table exists. Idempotent. */
export async function initSystemSettingsTable(pool: DbPool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

/** Read persisted owner token from system_settings table if it exists. */
export async function readPersistedOwnerToken(pool: DbPool): Promise<string | null> {
  const result = await pool.query(
    `SELECT value FROM system_settings WHERE key = $1 LIMIT 1`,
    [OWNER_TOKEN_KEY],
  );
  if (result.rows.length === 0) {
    return null;
  }
  const row = result.rows[0] as { value?: unknown };
  if (typeof row.value === 'string' && row.value.trim() !== '') {
    return row.value.trim();
  }
  return null;
}

export class ServerClaimManager implements ClaimState {
  private pool: DbPool;
  private staticToken: string | null;
  private dynamicToken: string | null;
  private now: () => Date;

  constructor(options: {
    pool: DbPool;
    staticToken?: string | null;
    initialDynamicToken?: string | null;
    now?: () => Date;
  }) {
    this.pool = options.pool;
    this.staticToken = options.staticToken?.trim() || null;
    this.dynamicToken = options.initialDynamicToken?.trim() || null;
    this.now = options.now ?? (() => new Date());
  }

  isClaimed(): boolean {
    return this.staticToken !== null || this.dynamicToken !== null;
  }

  getOwnerToken(): string | null {
    return this.staticToken ?? this.dynamicToken;
  }

  async claim(
    requestedToken?: string,
  ): Promise<
    | { ok: true; ownerToken: string }
    | { ok: false; code: 'claim.already_claimed' }
  > {
    if (this.isClaimed()) {
      return { ok: false, code: 'claim.already_claimed' };
    }

    const tokenToUse =
      requestedToken?.trim() && requestedToken.trim().length > 0
        ? requestedToken.trim()
        : randomBytes(32).toString('hex');

    const createdAt = this.now().toISOString();

    const result = await this.pool.query(
      `INSERT INTO system_settings (key, value, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [OWNER_TOKEN_KEY, tokenToUse, createdAt],
    );

    if (result.rows.length === 0) {
      // Race condition: another request claimed it first
      const existing = await readPersistedOwnerToken(this.pool);
      if (existing) {
        this.dynamicToken = existing;
      }
      return { ok: false, code: 'claim.already_claimed' };
    }

    this.dynamicToken = tokenToUse;
    return { ok: true, ownerToken: tokenToUse };
  }
}
