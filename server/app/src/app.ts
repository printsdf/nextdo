/**
 * The Hono app (spec: app/database-guidelines.md "App backend").
 *
 * Three endpoints:
 *   POST /claim       → the ONE-TIME owner-token mint (claim R1).
 *                        UNAUTHENTICATED bootstrap path: while the server
 *                        is unclaimed (no env token, no persisted file)
 *                        the first call returns 200 { token } and closes
 *                        the claim (persisted); every later call — and
 *                        every call when a token exists (env or file) —
 *                        is 409 { reason: 'file' | 'explicit' }. The 200
 *                        body is the token's only display path; it never
 *                        reaches a log line.
 *   GET  /credentials → { token: <15-min PowerSync service JWT> }
 *   POST /upload      → applies one ps_crud batch to Postgres, synchronously,
 *                        in one transaction (2xx-on-rejection protocol —
 *                        see upload.ts).
 *
 * The two authed endpoints require the owner token (401 otherwise — no
 * anonymous access; a real account flow is post-MVP). While the server is
 * unclaimed, `ownerToken` is null and they 401 for EVERY request shape —
 * the claim above is the only way the first token appears.
 *
 * @nextdo/server is the PowerSync protocol boundary: it imports NOTHING
 * from the monorepo (spec: project/directory-structure.md Rule 1). The
 * request/response shapes mirror packages/db/src/powersync.ts, which is
 * the source of truth — a change on one side is a change to both.
 *
 * This module has NO side effects (no env reads, no server start): the
 * entry point (src/index.ts) owns those, so this module stays unit-
 * testable via `app.request()` with an injected pool + clock.
 *
 * CORS (prod-deploy task, design R5): the Hono app answers
 * `access-control-allow-origin: *` for Origin-bearing requests — the
 * Tauri desktop shell loads the web bundle from a file origin and
 * fetches cross-origin. `*` is safe here: the owner token travels in
 * the `Authorization` header, never in cookies, so the wildcard
 * exposes no credentialed state. The PowerSync Service already sends
 * `access-control-allow-origin: *` itself — only this backend needed it.
 * Auth middleware stays AFTER the CORS middleware; the 401 matrix and
 * endpoint behavior are unchanged.
 */
import { Hono, type Context, type Next } from 'hono';
import { cors } from 'hono/cors';
import { requireOwnerToken } from './auth.js';
import { mintPowerSyncJwt } from './credentials.js';
import { withTransaction, type DbPool } from './db.js';
import { logger } from './logger.js';
import { claimOwnerToken } from './owner-token.js';
import { applyCrudBatch, parseUploadBody } from './upload.js';

export interface ServerConfig {
  /** Postgres pool (injected — tests use an in-memory mock). */
  pool: DbPool;
  /** The shared owner token (NEXTDO_OWNER_TOKEN or the persisted file);
   *  null = unclaimed at boot — the first POST /claim mints it. */
  ownerToken: string | null;
  /** How the token resolved at boot (src/owner-token.ts) — drives the
   *  /claim 409 reason without re-reading the env/file. */
  ownerTokenSource: 'env' | 'file' | 'unclaimed';
  /** base64url shared secret the PowerSync service verifies with (JWT_SECRET). */
  jwtSecret: string;
  /** Injectable clock — defaults to the process clock. */
  now?: () => Date;
}

/** Build the Hono app (pure — no env reads, so it is unit-testable). */
export function createApp(config: ServerConfig): Hono {
  const now = config.now ?? (() => new Date());
  // CLOSURE VARIABLE holding the current token: a successful claim updates
  // it in-place, so /credentials works in the SAME process (a restart
  // recovers the same token from the file via resolveOwnerToken).
  let currentToken = config.ownerToken;
  // The auth guard reads the closure PER REQUEST (a middleware built from
  // the boot value would freeze null for an unclaimed boot).
  const requireCurrentToken = (c: Context, next: Next): Promise<Response | void> =>
    requireOwnerToken(currentToken)(c, next);
  const app = new Hono();

  // CORS first (before the auth middleware): every response to an
  // Origin-bearing request — including the 401s — carries the
  // access-control headers. The desktop webview needs `authorization`
  // pre-approved for the preflight of /credentials + /upload.
  app.use(
    '*',
    cors({
      origin: '*',
      allowHeaders: ['authorization', 'content-type'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
    }),
  );

  app.get(
    '/credentials',
    requireCurrentToken,
    async (c) => {
      const token = await mintPowerSyncJwt({ secret: config.jwtSecret, now: now() });
      // The client reads ONLY `data.token` (endpoint comes from its own
      // injected config) — nothing else in the body is contractual.
      return c.json({ token });
    },
  );

  app.post(
    '/upload',
    requireCurrentToken,
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        // Unparseable JSON — a protocol error, NOT a rejected op: 400
        // (the client's fetch is always well-formed JSON; a broken body
        // will not heal by retrying, so blocking the queue is correct).
        return c.json({ error: 'bad-request', code: 'upload.invalid-json' }, 400);
      }
      const parsed = parseUploadBody(body);
      if (parsed === null) {
        return c.json({ error: 'bad-request', code: 'upload.invalid-body' }, 400);
      }
      try {
        const outcome = await withTransaction(config.pool, (client) =>
          applyCrudBatch(client, parsed.ops, now()),
        );
        // 2xx even when `rejected` is non-empty (2xx-on-rejection).
        return c.json({ applied: outcome.applied, rejected: outcome.rejected });
      } catch (error) {
        // Transient/server failure ONLY → 5xx (the client blocks + retries).
        logger.error('upload.apply-failed', error);
        return c.json({ error: 'internal-server-error', code: 'server.transient-failure' }, 500);
      }
    },
  );

  // POST /claim — the unauthenticated bootstrap (claim R1). The token's
  // ONLY display path is the one 200 body; the success log line names the
  // event, never the token.
  app.post('/claim', async (c) => {
    const claimed409 = (reason: 'file' | 'explicit') =>
      c.json({ error: 'owner-token.claimed', code: 'owner-token.claimed', reason }, 409);
    // Fast path: boot already resolved the token (explicit env or
    // persisted file) → the claim window is closed, and the env/file
    // VALUE is never re-read or echoed.
    if (config.ownerTokenSource === 'env') {
      return claimed409('explicit');
    }
    if (config.ownerTokenSource === 'file') {
      return claimed409('file');
    }
    const result = await claimOwnerToken();
    if (!result.claimed) {
      // The file appeared since boot (manual rotation / concurrent
      // claim) — single-writer by design, but fail closed regardless.
      return claimed409(result.reason);
    }
    currentToken = result.token; // /credentials works from this process on
    logger.info('owner token claimed by first device — claim closed (token persisted)');
    return c.json({ token: result.token });
  });

  return app;
}
