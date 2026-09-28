/**
 * Owner-token auth — the 401 matrix (both endpoints) + the timing-safe
 * compare. Runs against the real Hono app (`app.request`) with a mocked
 * pg pool: the middleware runs, the auth decision is what is asserted.
 */
import { createApp } from '../src/app.js';
import {
  AUTH_UNAUTHORIZED_CODE,
  parseBearerToken,
  requireOwnerToken,
  timingSafeTokenEqual,
} from '../src/auth.js';
import type { Context, Hono, Next } from 'hono';
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

const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

describe('GET /credentials — 401 matrix', () => {
  it('401 without an Authorization header', async () => {
    const res = await buildApp().request('/credentials');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('auth.unauthorized');
  });

  it('401 with a non-Bearer scheme (Basic)', async () => {
    const res = await buildApp().request('/credentials', {
      headers: { Authorization: 'Basic abc123' },
    });
    expect(res.status).toBe(401);
  });

  it('401 with a lowercase `bearer` scheme (the client sends `Bearer`)', async () => {
    const res = await buildApp().request('/credentials', {
      headers: { Authorization: `bearer ${OWNER_TOKEN}` },
    });
    expect(res.status).toBe(401);
  });

  it('401 with the `Bearer` scheme but no token', async () => {
    const res = await buildApp().request('/credentials', {
      headers: { Authorization: 'Bearer' },
    });
    expect(res.status).toBe(401);
  });

  it('401 with an empty token', async () => {
    const res = await buildApp().request('/credentials', {
      headers: { Authorization: 'Bearer ' },
    });
    expect(res.status).toBe(401);
  });

  it('401 with the wrong token', async () => {
    const res = await buildApp().request('/credentials', {
      headers: bearer('wrong-token'),
    });
    expect(res.status).toBe(401);
  });

  it('200 with the valid token — the body carries a non-empty JWT string', async () => {
    const res = await buildApp().request('/credentials', { headers: bearer(OWNER_TOKEN) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token?: unknown };
    expect(typeof body.token).toBe('string');
    expect((body.token as string).length).toBeGreaterThan(0);
  });
});

describe('POST /upload — 401 matrix', () => {
  const post = (app: Hono, headers: Record<string, string> = {}) =>
    app.request('/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ ops: [] }),
    });

  it('401 without an Authorization header', async () => {
    expect((await post(buildApp())).status).toBe(401);
  });

  it('401 with a non-Bearer scheme', async () => {
    expect((await post(buildApp(), { Authorization: 'Token abc' })).status).toBe(401);
  });

  it('401 with the wrong token', async () => {
    expect((await post(buildApp(), bearer('nope'))).status).toBe(401);
  });

  it('200 with the valid token', async () => {
    const res = await post(buildApp(), bearer(OWNER_TOKEN));
    expect(res.status).toBe(200);
  });
});

describe('parseBearerToken', () => {
  it('null on a missing header', () => {
    expect(parseBearerToken(undefined)).toBeNull();
  });

  it('null on the scheme without a token', () => {
    expect(parseBearerToken('Bearer')).toBeNull();
  });

  it('null on an empty token', () => {
    expect(parseBearerToken('Bearer ')).toBeNull();
  });

  it('null on a non-Bearer scheme', () => {
    expect(parseBearerToken('Basic abc')).toBeNull();
    expect(parseBearerToken('bearer abc')).toBeNull();
  });

  it('returns the token on a valid header', () => {
    expect(parseBearerToken('Bearer abc.def_ghi-012')).toBe('abc.def_ghi-012');
  });
});

describe('timingSafeTokenEqual', () => {
  it('true for identical tokens', () => {
    expect(timingSafeTokenEqual('the-token', 'the-token')).toBe(true);
  });

  it('false for different tokens of the same length', () => {
    expect(timingSafeTokenEqual('the-token', 'other-token')).toBe(false);
  });

  it('false for different lengths — and must NOT throw (the hashing path)', () => {
    expect(() => timingSafeTokenEqual('a', 'a-much-longer-token')).not.toThrow();
    expect(timingSafeTokenEqual('a', 'a-much-longer-token')).toBe(false);
    expect(timingSafeTokenEqual('', 'x')).toBe(false);
  });
});

describe('requireOwnerToken middleware shape', () => {
  it('does not call next() on rejection (the handler never runs) and returns a 401 Response', async () => {
    const next: Next = jest.fn();
    const mw = requireOwnerToken(OWNER_TOKEN);
    // The stub returns a REAL Response: in Hono, c.json() is what the
    // middleware returns as the short-circuit 401 response.
    const json = jest.fn(
      (payload: unknown, status?: number) =>
        new Response(JSON.stringify(payload), {
          status: status ?? 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const c = {
      req: { header: () => 'Bearer wrong' },
      json,
    } as unknown as Context;
    const result = await mw(c, next);
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ error: 'unauthorized', code: AUTH_UNAUTHORIZED_CODE }, 401);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});
