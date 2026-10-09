/**
 * The Hono app (spec: app/database-guidelines.md "App backend").
 *
 * Two endpoints:
 *   GET  /credentials → { token: <15-min PowerSync service JWT>,
 *                         endpoint: <NEXTDO_SYNC_ENDPOINT> }
 *   POST /upload      → applies one ps_crud batch to Postgres, synchronously,
 *                        in one transaction (2xx-on-rejection protocol —
 *                        see upload.ts).
 *
 * Both endpoints require the owner token (401 otherwise — no anonymous
 * access; a real account flow is post-MVP). The token is env-only and
 * immutable for the process's life (src/owner-token.ts refuses to boot
 * without it), and so is the sync endpoint (src/sync-endpoint.ts refuses
 * to boot without NEXTDO_SYNC_ENDPOINT).
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
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireOwnerToken } from './auth.js';
import type { ClaimState } from './claim.js';
import { mintPowerSyncJwt } from './credentials.js';
import { withTransaction, type DbPool } from './db.js';
import { logger } from './logger.js';
import { applyCrudBatch, parseUploadBody } from './upload.js';

export interface ServerConfig {
  /** Postgres pool (injected — tests use an in-memory mock). */
  pool: DbPool;
  /** The shared owner token — static boot value or omitted when using claimState. */
  ownerToken?: string | null;
  /** Dynamic claim state manager for pairing & token bootstrap. */
  claimState?: ClaimState;
  /** Optional secret required to claim the server, preventing unauthorized claim on public endpoints. */
  claimSecret?: string | null;
  /** base64url shared secret the PowerSync service verifies with (JWT_SECRET). */
  jwtSecret: string;
  /** The public PowerSync stream URL — `NEXTDO_SYNC_ENDPOINT`, required at
   *  boot (src/sync-endpoint.ts refuses to start without it). Handed to
   *  every client with `/credentials`, so the deployment owns the path
   *  layout and devices never have to guess it. */
  syncEndpoint: string;
  /** Injectable clock — defaults to the process clock. */
  now?: () => Date;
}

/** Build the Hono app (pure — no env reads, so it is unit-testable). */
export function createApp(config: ServerConfig): Hono {
  const now = config.now ?? (() => new Date());
  const tokenResolver = config.claimState
    ? () => config.claimState!.getOwnerToken()
    : (config.ownerToken ?? null);
  const requireAuth = requireOwnerToken(tokenResolver);
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

  const api = new Hono();

  api.get('/', async (c) => {
    const isClaimed = config.claimState
      ? config.claimState.isClaimed()
      : config.ownerToken != null && config.ownerToken.trim() !== '';

    const accept = c.req.header('accept') || '';
    if (accept.includes('text/html')) {
      const origin = new URL(c.req.url).origin;
      return c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nextdo 云同步服务</title>
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --success: #4ade80;
    }
    body {
      margin: 0;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      box-sizing: border-box;
    }
    .container {
      max-width: 580px;
      width: 100%;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
    }
    h1 { margin: 0 0 8px; font-size: 24px; font-weight: 700; }
    p { margin: 0 0 20px; color: var(--muted); font-size: 14px; line-height: 1.5; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(74, 222, 128, 0.15);
      color: var(--success);
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
    }
    .box {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .box-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .url-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .url-input {
      flex: 1;
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      color: var(--accent);
      font-family: monospace;
      font-size: 14px;
      outline: none;
    }
    button {
      background: var(--accent);
      color: #0f172a;
      border: none;
      border-radius: 8px;
      padding: 10px 16px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    button:hover { opacity: 0.9; }
    .steps {
      display: flex;
      flex-direction: column;
      gap: 12px;
      font-size: 14px;
      color: var(--text);
    }
    .step-item {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      line-height: 1.4;
    }
    .step-num {
      background: rgba(56, 189, 248, 0.2);
      color: var(--accent);
      width: 22px;
      height: 22px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
      flex-shrink: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge"><span class="badge-dot"></span> 服务正常运行 · 数据库已自动就绪</div>
    <h1>Nextdo 云同步服务</h1>
    <p>你的 Cloudflare Workers 后端已就绪。所有 14 张核心数据表已自动初始化完成，无需手动建表。</p>
    
    <div class="box">
      <div class="box-title">你的同步服务器网址</div>
      <div class="url-row">
        <input class="url-input" id="srvUrl" value="${origin}" readonly />
        <button onclick="navigator.clipboard.writeText(document.getElementById('srvUrl').value); this.innerText='已复制'; setTimeout(()=>this.innerText='复制', 2000)">复制</button>
      </div>
    </div>

    <div class="box">
      <div class="box-title">如何在 Nextdo 客户端开启同步</div>
      <div class="steps">
        <div class="step-item">
          <div class="step-num">1</div>
          <div>打开 Nextdo 应用（iOS / Android / macOS / Windows），进入 <strong>设置</strong> 页面。</div>
        </div>
        <div class="step-item">
          <div class="step-num">2</div>
          <div>找到 <strong>云同步</strong> 卡片，直接填入上方复制的服务器网址。</div>
        </div>
        <div class="step-item">
          <div class="step-num">3</div>
          <div>点击 <strong>连接</strong>，首台设备将自动免密绑定并开启实时双向同步！</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`);
    }

    return c.json({
      status: 'ok',
      service: 'Nextdo Cloud Sync Server',
      database: 'connected & schema initialized',
      claimed: isClaimed,
      syncEndpointConfigured: Boolean(config.syncEndpoint),
      version: '1.0.0',
    });
  });

  api.get('/health', async (c) => {
    return c.json({ status: 'ok' });
  });

  api.get('/claim/status', async (c) => {
    const claimed = config.claimState
      ? config.claimState.isClaimed()
      : config.ownerToken != null && config.ownerToken.trim() !== '';
    const requiresSecret = Boolean(
      !claimed && config.claimSecret && config.claimSecret.trim().length > 0,
    );
    return c.json({ claimed, requiresSecret });
  });

  api.post('/claim', async (c) => {
    if (!config.claimState) {
      return c.json({ error: 'already_claimed', code: 'claim.already_claimed' }, 409);
    }
    if (config.claimState.isClaimed()) {
      return c.json({ error: 'already_claimed', code: 'claim.already_claimed' }, 409);
    }
    let body: { ownerToken?: string; claimSecret?: string } = {};
    try {
      body = (await c.req.json()) as { ownerToken?: string; claimSecret?: string };
    } catch {
      // Empty or non-JSON payload is allowed (auto-generate token)
    }

    if (config.claimSecret && config.claimSecret.trim().length > 0) {
      const headerSecret = c.req.header('x-claim-secret')?.trim();
      const authHeader = c.req.header('authorization')?.trim();
      const bearerSecret = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;
      const providedSecret = headerSecret || bearerSecret || body.claimSecret?.trim();

      if (!providedSecret || providedSecret !== config.claimSecret.trim()) {
        return c.json(
          {
            error: 'forbidden',
            code: 'claim.invalid_secret',
            message: 'A valid claim secret is required to claim this server.',
          },
          403,
        );
      }
    }

    const result = await config.claimState.claim(body.ownerToken);
    if (!result.ok) {
      return c.json({ error: 'already_claimed', code: result.code }, 409);
    }
    return c.json({ ok: true, ownerToken: result.ownerToken });
  });

  api.get(
    '/credentials',
    requireAuth,
    async (c) => {
      const token = await mintPowerSyncJwt({ secret: config.jwtSecret, now: now() });
      // `token` is the 15-min PowerSync JWT the client hands to the SDK;
      // `endpoint` is the deployment's public stream URL (NEXTDO_SYNC_ENDPOINT).
      // The endpoint carries NO authority — the PowerSync service
      // authenticates the JWT itself — so handing it to every device is
      // safe, and it lets the deployer fix the path layout once instead of
      // every device guessing `/sync`. `endpoint` is contractual since
      // 10-02-simplify-sync-setup: a client that does not understand it
      // falls back to its own derived/stored value (backward compatible
      // both ways — see design.md "向后兼容矩阵").
      return c.json({ token, endpoint: config.syncEndpoint });
    },
  );

  api.post(
    '/upload',
    requireAuth,
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

  // Mount routes at both root and /api so single-domain, Workers, and
  // reverse-proxy layouts work without client reconfiguration.
  app.route('/', api);
  app.route('/api', api);

  return app;
}
