/**
 * Owner-token verification — v1 single-user auth (spec:
 * app/database-guidelines.md "App backend"). Both endpoints require the
 * owner token; there is no anonymous access. A real account flow is
 * post-MVP; the seam (one Bearer credential checked before any handler
 * runs) stays.
 *
 * 401 matrix (fail closed — every bad shape is a 401):
 *   - missing Authorization header  → 401
 *   - non-`Bearer` scheme           → 401 (case-sensitive: the client
 *                                       always sends `Bearer`)
 *   - empty token                   → 401
 *   - token mismatch                → 401
 *   - valid                         → pass
 *
 * The comparison is timing-safe: both sides are SHA-256 hashed first
 * (equal-length digests, so `timingSafeEqual` never throws on length
 * differences) and then compared with `crypto.timingSafeEqual`.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, Next } from 'hono';

/** Stable error code (convention: typed, branchable codes). */
export const AUTH_UNAUTHORIZED_CODE = 'auth.unauthorized';

const BEARER_PREFIX = 'Bearer ';

/**
 * Extract the token from an `Authorization` header. Returns null for every
 * invalid shape (missing header, non-Bearer scheme, empty token) — the
 * caller maps null to 401.
 */
export function parseBearerToken(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }
  if (!header.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = header.slice(BEARER_PREFIX.length);
  if (token === '') {
    return null;
  }
  return token;
}

/**
 * Timing-safe comparison of two secrets. Hashing first makes the inputs
 * equal-length so `timingSafeEqual` cannot throw, and the compare cost no
 * longer reveals the expected token's length.
 */
export function timingSafeTokenEqual(presented: string, expected: string): boolean {
  const presentedHash = createHash('sha256').update(presented, 'utf8').digest();
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(presentedHash, expectedHash);
}

/**
 * Hono middleware: verify `Authorization: Bearer <ownerToken>` and answer
 * 401 (no body hints at WHY — all rejections look identical) on failure.
 * `expectedToken` is the immutable boot value (env-only — the server
 * refuses to start without it; see src/owner-token.ts).
 */
export function requireOwnerToken(expectedToken: string) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const presented = parseBearerToken(c.req.header('authorization'));
    if (presented === null || !timingSafeTokenEqual(presented, expectedToken)) {
      return c.json({ error: 'unauthorized', code: AUTH_UNAUTHORIZED_CODE }, 401);
    }
    await next();
  };
}
