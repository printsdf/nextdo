/**
 * `fetchCredentialsOnce` — the single owner of the /credentials wire
 * protocol (prod-deploy design R3): the connector maps its result back to
 * the null/throw contract (pinned by connector.test.ts), the app's Gate +
 * startup pre-check branch on it directly.
 *
 * `fetch` is mocked; the function takes the owner token as an argument,
 * so no storage backend is involved.
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

  it('ignores non-contractual extra fields in the body', async () => {
    mockFetch(200, { token: 'ps-service-jwt', endpoint: 'http://ignored', extra: 1 });

    const result = await fetchCredentialsOnce(CONFIG, 'owner-token-1');

    expect(result).toEqual({ ok: true, token: 'ps-service-jwt' });
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
