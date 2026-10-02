/**
 * `fetchCredentialsOnce` — the single owner of the /credentials wire
 * protocol (prod-deploy design R3): the connector maps its result back to
 * the null/throw contract (pinned by connector.test.ts), the app's Gate +
 * startup pre-check branch on it directly.
 *
 * `fetch` is mocked; the function takes the owner token as an argument,
 * so no storage backend is involved.
 *
 * 10-02-simplify-sync-setup: a 200 body may also carry `endpoint` — the
 * deployment's NEXTDO_SYNC_ENDPOINT. It is ADOPTED when it is an absolute
 * http(s) URL, and simply OMITTED when it is missing or malformed (the
 * caller falls back to its own config). A bad endpoint NEVER downgrades a
 * 200 to `invalid`: token and endpoint have different failure semantics.
 */
import { fetchCredentialsOnce, type NextdoPowerSyncConfig } from '../powersync';

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

describe('fetchCredentialsOnce — 200 with a token', () => {
  it('returns { ok: true, token } and sends the Bearer owner token', async () => {
    const fetchMock = mockFetch(200, { token: 'ps-service-jwt' });

    const result = await fetchCredentialsOnce(CONFIG, 'owner-token-1');

    expect(result).toEqual({ ok: true, token: 'ps-service-jwt' });
    expect(fetchMock).toHaveBeenCalledWith(CONFIG.backendUrl + '/credentials', {
      headers: { Authorization: 'Bearer owner-token-1' },
    });
  });

  it('adopts a server-supplied endpoint (10-02: the deployment owns the path layout)', async () => {
    mockFetch(200, {
      token: 'ps-service-jwt',
      endpoint: 'https://custom.example.com/stream',
      extra: 1,
    });

    const result = await fetchCredentialsOnce(CONFIG, 'owner-token-1');

    expect(result).toEqual({
      ok: true,
      token: 'ps-service-jwt',
      endpoint: 'https://custom.example.com/stream',
    });
  });

  it('omits endpoint when the server did not send one (old server — the caller falls back)', async () => {
    mockFetch(200, { token: 'ps-service-jwt' });

    const result = await fetchCredentialsOnce(CONFIG, 'owner-token-1');

    // No `endpoint` key at all, NOT `endpoint: undefined` — so the caller
    // can distinguish "not sent" from "sent something".
    expect(result).toEqual({ ok: true, token: 'ps-service-jwt' });
    expect('endpoint' in result).toBe(false);
  });

  it.each([
    ['a non-http(s) scheme', 'ftp://bad'],
    ['a relative value', '/sync'],
    ['a bare host with no scheme', 'custom.example.com/stream'],
    ['an empty string', ''],
    ['a whitespace-only string', '   '],
    ['a non-string value', 42],
    ['null', null],
  ])('omits endpoint when it is malformed (%s) — and does NOT fail the handshake', async (
    _label,
    value,
  ) => {
    mockFetch(200, { token: 'ps-service-jwt', endpoint: value });

    const result = await fetchCredentialsOnce(CONFIG, 'owner-token-1');

    expect(result).toEqual({ ok: true, token: 'ps-service-jwt' });
  });

  it('trims a server endpoint with surrounding whitespace', async () => {
    mockFetch(200, { token: 'ps-service-jwt', endpoint: '  https://custom.example.com/stream \n' });

    await expect(fetchCredentialsOnce(CONFIG, 'owner-token-1')).resolves.toEqual({
      ok: true,
      token: 'ps-service-jwt',
      endpoint: 'https://custom.example.com/stream',
    });
  });
});

describe('fetchCredentialsOnce — 200 WITHOUT a usable token (kind: invalid)', () => {
  it('body without a token field', async () => {
    mockFetch(200, { unexpected: true });
    await expect(fetchCredentialsOnce(CONFIG, 't')).resolves.toEqual({
      ok: false,
      kind: 'invalid',
    });
  });

  it('empty-string token (the mint endpoint never returns one)', async () => {
    mockFetch(200, { token: '' });
    await expect(fetchCredentialsOnce(CONFIG, 't')).resolves.toEqual({
      ok: false,
      kind: 'invalid',
    });
  });

  it('non-string token', async () => {
    mockFetch(200, { token: 42 });
    await expect(fetchCredentialsOnce(CONFIG, 't')).resolves.toEqual({
      ok: false,
      kind: 'invalid',
    });
  });

  it('unparseable JSON body', async () => {
    mockFetch(200, undefined, true);
    await expect(fetchCredentialsOnce(CONFIG, 't')).resolves.toEqual({
      ok: false,
      kind: 'invalid',
    });
  });
});

describe('fetchCredentialsOnce — non-2xx (kind: rejected)', () => {
  it('401 (wrong owner token) carries the status', async () => {
    mockFetch(401, { error: 'unauthorized', code: 'auth.unauthorized' });
    await expect(fetchCredentialsOnce(CONFIG, 'wrong')).resolves.toEqual({
      ok: false,
      kind: 'rejected',
      status: 401,
    });
  });

  it('500 (transient server failure) carries the status', async () => {
    mockFetch(500);
    await expect(fetchCredentialsOnce(CONFIG, 't')).resolves.toEqual({
      ok: false,
      kind: 'rejected',
      status: 500,
    });
  });
});

describe('fetchCredentialsOnce — network failure (kind: network, never throws)', () => {
  it('fetch rejection maps to { ok: false, kind: network } with the error detail', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(fetchCredentialsOnce(CONFIG, 't')).resolves.toEqual({
      ok: false,
      kind: 'network',
      detail: 'ECONNREFUSED',
    });
  });

  it('a non-Error rejection still never throws', async () => {
    global.fetch = jest.fn().mockRejectedValue('socket closed');

    const result = await fetchCredentialsOnce(CONFIG, 't');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('network');
  });
});
