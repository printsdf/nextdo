/**
 * `claimOwnerTokenOnce` — the single owner of the /claim wire protocol
 * (claim task 09-28, R3): the one-time owner-token bootstrap the Settings
 * tab calls when the user submits an EMPTY token.
 *
 * `fetch` is mocked; the function takes the config, so no storage backend
 * is involved (same test shape as fetch-credentials-once.test.ts).
 */
import { claimOwnerTokenOnce, type NextdoPowerSyncConfig } from '../powersync';

const CONFIG: NextdoPowerSyncConfig = {
  backendUrl: 'http://backend.test',
  endpoint: 'http://powersync-service.test',
};

function mockFetch(status: number, body?: unknown, jsonFails = false) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => (jsonFails ? Promise.reject(new Error('bad json')) : Promise.resolve(body)),
  } as Response);
  global.fetch = fetchMock;
  return fetchMock;
}

beforeEach(() => {
  jest.restoreAllMocks();
});

describe('claimOwnerTokenOnce — 200 with a token', () => {
  it('returns { ok: true, token } and POSTs to /claim WITHOUT an auth header', async () => {
    const fetchMock = mockFetch(200, { token: 'a'.repeat(64) });

    const result = await claimOwnerTokenOnce(CONFIG);

    expect(result).toEqual({ ok: true, token: 'a'.repeat(64) });
    expect(fetchMock).toHaveBeenCalledWith(CONFIG.backendUrl + '/claim', { method: 'POST' });
    // The bootstrap is UNAUTHENTICATED — no Authorization header.
    const init = fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined;
    expect(init?.headers).toBeUndefined();
  });

  it('ignores non-contractual extra fields in the body', async () => {
    mockFetch(200, { token: 'b'.repeat(64), extra: 1 });

    const result = await claimOwnerTokenOnce(CONFIG);

    expect(result).toEqual({ ok: true, token: 'b'.repeat(64) });
  });
});

describe('claimOwnerTokenOnce — 200 WITHOUT a usable token (kind: invalid)', () => {
  it('body without a token field', async () => {
    mockFetch(200, { unexpected: true });
    await expect(claimOwnerTokenOnce(CONFIG)).resolves.toEqual({ ok: false, kind: 'invalid' });
  });

  it('empty-string token', async () => {
    mockFetch(200, { token: '' });
    await expect(claimOwnerTokenOnce(CONFIG)).resolves.toEqual({ ok: false, kind: 'invalid' });
  });

  it('non-string token', async () => {
    mockFetch(200, { token: 42 });
    await expect(claimOwnerTokenOnce(CONFIG)).resolves.toEqual({ ok: false, kind: 'invalid' });
  });

  it('unparseable JSON body', async () => {
    mockFetch(200, undefined, true);
    await expect(claimOwnerTokenOnce(CONFIG)).resolves.toEqual({ ok: false, kind: 'invalid' });
  });
});

describe('claimOwnerTokenOnce — 409 (kind: claimed)', () => {
  it('carries reason "file" from the body', async () => {
    mockFetch(409, { error: 'owner-token.claimed', code: 'owner-token.claimed', reason: 'file' });
    await expect(claimOwnerTokenOnce(CONFIG)).resolves.toEqual({
      ok: false,
      kind: 'claimed',
      reason: 'file',
    });
  });

  it('carries reason "explicit" from the body', async () => {
    mockFetch(409, { error: 'owner-token.claimed', code: 'owner-token.claimed', reason: 'explicit' });
    await expect(claimOwnerTokenOnce(CONFIG)).resolves.toEqual({
      ok: false,
      kind: 'claimed',
      reason: 'explicit',
    });
  });

  it('a 409 WITHOUT a reason falls back to "file"', async () => {
    mockFetch(409, { error: 'owner-token.claimed', code: 'owner-token.claimed' });
    await expect(claimOwnerTokenOnce(CONFIG)).resolves.toEqual({
      ok: false,
      kind: 'claimed',
      reason: 'file',
    });
  });

  it('a 409 with an unknown reason value also falls back to "file"', async () => {
    mockFetch(409, { reason: 'weird' });
    await expect(claimOwnerTokenOnce(CONFIG)).resolves.toEqual({
      ok: false,
      kind: 'claimed',
      reason: 'file',
    });
  });

  it('a 409 with an unparseable body falls back to "file"', async () => {
    mockFetch(409, undefined, true);
    await expect(claimOwnerTokenOnce(CONFIG)).resolves.toEqual({
      ok: false,
      kind: 'claimed',
      reason: 'file',
    });
  });
});

describe('claimOwnerTokenOnce — other statuses (kind: network)', () => {
  it('500 (transient server failure)', async () => {
    mockFetch(500);
    await expect(claimOwnerTokenOnce(CONFIG)).resolves.toEqual({ ok: false, kind: 'network' });
  });

  it('401 (an unexpected auth rejection on the bootstrap path)', async () => {
    mockFetch(401, { error: 'unauthorized', code: 'auth.unauthorized' });
    await expect(claimOwnerTokenOnce(CONFIG)).resolves.toEqual({ ok: false, kind: 'network' });
  });
});

describe('claimOwnerTokenOnce — network failure (never throws)', () => {
  it('fetch rejection maps to { ok: false, kind: network }', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(claimOwnerTokenOnce(CONFIG)).resolves.toEqual({
      ok: false,
      kind: 'network',
    });
  });

  it('a non-Error rejection still never throws', async () => {
    global.fetch = jest.fn().mockRejectedValue('socket closed');

    const result = await claimOwnerTokenOnce(CONFIG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('network');
  });
});
