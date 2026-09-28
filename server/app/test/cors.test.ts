/**
 * CORS (prod-deploy task, design R5) — the Hono app must answer
 * cross-origin requests from the Tauri desktop webview:
 *   - the OPTIONS preflight (Origin + Access-Control-Request-Header:
 *     authorization) gets 204 + the allow-* headers;
 *   - every response to an Origin-bearing request — including the 401s —
 *     carries `access-control-allow-origin: *`.
 * Requests WITHOUT an Origin header (native Expo clients) are untouched.
 * Runs against the real Hono app (`app.request`) with a mocked pg pool.
 */
import { createApp } from '../src/app.js';
import type { Hono } from 'hono';
import { createMockPool, JWT_SECRET, NOW, OWNER_TOKEN } from './helpers.js';

function buildApp(): Hono {
  const { pool } = createMockPool();
  return createApp({
    pool,
    ownerToken: OWNER_TOKEN,
    ownerTokenSource: 'env',
    jwtSecret: JWT_SECRET,
    now: () => NOW,
  });
}

const ORIGIN = 'http://tauri.localhost';

describe('OPTIONS preflight', () => {
  const preflight = (path: string, method = 'GET') =>
    buildApp().request(path, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Header': 'authorization',
      },
    });

  it('answers 204 with allow-origin * for GET /credentials', async () => {
    const res = await preflight('/credentials');
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('pre-approves the authorization + content-type headers', async () => {
    const res = await preflight('/credentials');
    const allowHeaders = (res.headers.get('access-control-allow-headers') ?? '')
      .toLowerCase()
      .split(',')
      .map((h) => h.trim());
    expect(allowHeaders).toEqual(expect.arrayContaining(['authorization', 'content-type']));
  });

  it('pre-approves GET, POST and OPTIONS', async () => {
    const res = await preflight('/upload', 'POST');
    const allowMethods = (res.headers.get('access-control-allow-methods') ?? '')
      .toUpperCase()
      .split(',')
      .map((m) => m.trim());
    expect(allowMethods).toEqual(expect.arrayContaining(['GET', 'POST', 'OPTIONS']));
  });

  it('the preflight short-circuits BEFORE auth (no 401, no pool access)', async () => {
    const res = await preflight('/upload', 'POST');
    expect(res.status).toBe(204);
  });
});

describe('Origin-bearing responses carry access-control-allow-origin', () => {
  it('GET /credentials without a token: 401 AND the ACAO header (the 401 stays in the 401 matrix)', async () => {
    const res = await buildApp().request('/credentials', {
      headers: { Origin: ORIGIN },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('GET /credentials with the valid token: 200 AND the ACAO header', async () => {
    const res = await buildApp().request('/credentials', {
      headers: { Origin: ORIGIN, Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('POST /upload without a token: 401 AND the ACAO header', async () => {
    const res = await buildApp().request('/upload', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ops: [] }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('POST /upload with the valid token: 200 AND the ACAO header', async () => {
    const res = await buildApp().request('/upload', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OWNER_TOKEN}`,
      },
      body: JSON.stringify({ ops: [] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('requests without an Origin header (native Expo clients)', () => {
  // hono's cors middleware with `origin: '*'` answers the ACAO header on
  // EVERY response (the findAllowOrigin predicate ignores the request
  // origin). Harmless without a cross-origin context — no cookies travel
  // with the token, so the wildcard exposes nothing — and the auth matrix
  // (status codes) is what native clients actually see.
  it('GET /credentials: 401 without a token, auth matrix unchanged', async () => {
    const res = await buildApp().request('/credentials');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('auth.unauthorized');
  });

  it('GET /credentials: 200 with the valid token', async () => {
    const res = await buildApp().request('/credentials', {
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(res.status).toBe(200);
  });
});
