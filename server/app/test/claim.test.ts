/**
 * POST /claim (claim task 09-28, R1) — the one-time owner-token mint,
 * run against the REAL Hono app (`app.request`) with a mocked pg pool:
 *   - unclaimed: /credentials + /upload 401 for ANY Bearer; POST /claim
 *     200 { 64-hex token } + file persisted + log line WITHOUT the token;
 *     the same process answers /credentials 200 with the minted token
 *     (closure update — no restart); the second claim is 409 'file';
 *   - booted with an explicit env token → 409 'explicit', and the env
 *     token never appears in the response;
 *   - booted from the persisted file → 409 'file' (the durable "claim
 *     closed" marker after a restart);
 *   - CORS: the preflight + the claim responses carry the ACAO header.
 *
 * The unclaimed claim path reads process.env (claimOwnerToken's default),
 * so the suite points NEXTDO_OWNER_TOKEN_FILE at a fresh temp file and
 * unsets NEXTDO_OWNER_TOKEN for its lifetime (saved + restored).
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import type { Hono } from 'hono';
import { createMockPool, JWT_SECRET } from './helpers.js';
import { logger } from '../src/logger.js';

const ENV_TOKEN = 'NEXTDO_OWNER_TOKEN';
const ENV_TOKEN_FILE = 'NEXTDO_OWNER_TOKEN_FILE';

let dir: string;
let tokenFile: string;
let savedEnv: { token: string | undefined; file: string | undefined };
let infoSpy: jest.SpyInstance;

function buildApp(overrides: Partial<Parameters<typeof createApp>[0]> = {}): Hono {
  const { pool } = createMockPool();
  return createApp({
    pool,
    ownerToken: null,
    ownerTokenSource: 'unclaimed',
    jwtSecret: JWT_SECRET,
    ...overrides,
  });
}

function allLogged(): string {
  return infoSpy.mock.calls.map((call) => String(call[0])).join('\n');
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'nextdo-claim-route-'));
  tokenFile = path.join(dir, 'data', 'owner-token');
  savedEnv = { token: process.env[ENV_TOKEN], file: process.env[ENV_TOKEN_FILE] };
  delete process.env[ENV_TOKEN];
  process.env[ENV_TOKEN_FILE] = tokenFile;
  infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
});

afterEach(async () => {
  infoSpy.mockRestore();
  if (savedEnv.token === undefined) delete process.env[ENV_TOKEN];
  else process.env[ENV_TOKEN] = savedEnv.token;
  if (savedEnv.file === undefined) delete process.env[ENV_TOKEN_FILE];
  else process.env[ENV_TOKEN_FILE] = savedEnv.file;
  await rm(dir, { recursive: true, force: true });
});

describe('unclaimed server (no env token, no file)', () => {
  it('401s /credentials for ANY Bearer shape (the response shape is unchanged)', async () => {
    const app = buildApp();
    for (const auth of [undefined, 'Bearer ', 'Bearer anything', 'Basic abc']) {
      const res = await app.request('/credentials', {
        headers: auth === undefined ? {} : { Authorization: auth },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string; code: string };
      expect(body).toEqual({ error: 'unauthorized', code: 'auth.unauthorized' });
    }
  });

  it('401s /upload for ANY Bearer shape', async () => {
    const app = buildApp();
    for (const auth of ['Bearer anything', 'Bearer valid-looking-64-hex']) {
      const res = await app.request('/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({ ops: [] }),
      });
      expect(res.status).toBe(401);
    }
  });

  it('POST /claim → 200 { token } (64-hex), the token is persisted, and NO log line contains it', async () => {
    const app = buildApp();
    const res = await app.request('/claim', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    // The file is the durable "claim closed" marker.
    expect((await readFile(tokenFile, 'utf8')).trim()).toBe(body.token);
    // The success log names the event, never the token.
    expect(allLogged()).not.toBe('');
    expect(allLogged()).not.toContain(body.token);
  });

  it('after a claim, the SAME process answers /credentials 200 with the minted token (no restart)', async () => {
    const app = buildApp();
    const claimRes = await app.request('/claim', { method: 'POST' });
    const { token } = (await claimRes.json()) as { token: string };

    const res = await app.request('/credentials', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    // …and a wrong token still 401s.
    const wrong = await app.request('/credentials', {
      headers: { Authorization: 'Bearer wrong' },
    });
    expect(wrong.status).toBe(401);
  });

  it('the second POST /claim → 409 { error, code, reason: "file" }', async () => {
    const app = buildApp();
    expect((await app.request('/claim', { method: 'POST' })).status).toBe(200);

    const res = await app.request('/claim', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'owner-token.claimed',
      code: 'owner-token.claimed',
      reason: 'file',
    });
  });
});

describe('booted with an explicit env token', () => {
  it('POST /claim → 409 reason "explicit" and the env token NEVER appears in the response', async () => {
    const app = buildApp({ ownerToken: 'env-secret-token', ownerTokenSource: 'env' });
    const res = await app.request('/claim', { method: 'POST' });
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(text).not.toContain('env-secret-token');
    expect(JSON.parse(text)).toEqual({
      error: 'owner-token.claimed',
      code: 'owner-token.claimed',
      reason: 'explicit',
    });
  });

  it('/credentials keeps behaving as today (env token works)', async () => {
    const app = buildApp({ ownerToken: 'env-secret-token', ownerTokenSource: 'env' });
    const ok = await app.request('/credentials', {
      headers: { Authorization: 'Bearer env-secret-token' },
    });
    expect(ok.status).toBe(200);
    const bad = await app.request('/credentials');
    expect(bad.status).toBe(401);
  });
});

describe('booted from the persisted file (a restart after a claim)', () => {
  it('POST /claim → 409 reason "file" (the file is the durable "claim closed" marker)', async () => {
    const app = buildApp({ ownerToken: 'token-from-file', ownerTokenSource: 'file' });
    const res = await app.request('/claim', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'owner-token.claimed',
      code: 'owner-token.claimed',
      reason: 'file',
    });
  });
});

describe('CORS covers /claim (the desktop webview claims cross-origin)', () => {
  const ORIGIN = 'http://tauri.localhost';

  it('the OPTIONS preflight gets 204 + access-control-allow-origin: *', async () => {
    const res = await buildApp().request('/claim', {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('a cross-origin POST /claim response carries the ACAO header (both outcomes)', async () => {
    const app = buildApp();
    const first = await app.request('/claim', { method: 'POST', headers: { Origin: ORIGIN } });
    expect(first.status).toBe(200);
    expect(first.headers.get('access-control-allow-origin')).toBe('*');
    const second = await app.request('/claim', { method: 'POST', headers: { Origin: ORIGIN } });
    expect(second.status).toBe(409);
    expect(second.headers.get('access-control-allow-origin')).toBe('*');
  });
});
