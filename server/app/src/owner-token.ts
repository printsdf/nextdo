/**
 * Owner-token boot resolution — the ONE source of truth is the
 * `NEXTDO_OWNER_TOKEN` environment variable (deploy-owned token): it is
 * generated ONCE at deploy time (`openssl rand -hex 32`) and written into
 * `server/deploy/.env`. There is no persisted file, no auto-generation,
 * and no log line that ever prints the token.
 *
 * Contract:
 *   - non-empty after trim → returned as the process's immutable token;
 *   - missing / empty / whitespace-only → THROW (the process entry turns
 *     that into a refused boot) with an actionable message naming the
 *     generation command and the .env location.
 *
 * A restart is never a rotation: the same .env value resolves to the same
 * token every boot, so no device ever has to re-enter it.
 */

export interface OwnerTokenEnv {
  NEXTDO_OWNER_TOKEN?: string;
}

/**
 * Resolve the owner token for this boot. Synchronous and side-effect-free
 * (env-only — the file path is gone). Throws on a missing/empty value so
 * the boot refuses instead of running unauthenticated.
 */
export function resolveOwnerToken(env: OwnerTokenEnv = process.env): string {
  const trimmed = env.NEXTDO_OWNER_TOKEN?.trim();
  if (trimmed !== undefined && trimmed !== '') {
    return trimmed;
  }
  throw new Error(
    'NEXTDO_OWNER_TOKEN is not set — generate one with: openssl rand -hex 32 and set it in server/deploy/.env',
  );
}
