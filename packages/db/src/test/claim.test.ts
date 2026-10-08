import { claimServer, fetchClaimStatus } from '../claim';

const BACKEND_URL = 'https://nextdo.example.com/api';

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

describe('fetchClaimStatus', () => {
  it('returns { ok: true, claimed: false } when server is unclaimed', async () => {
    const fetchMock = mockFetch(200, { claimed: false });

    const result = await fetchClaimStatus(BACKEND_URL);

    expect(result).toEqual({ ok: true, claimed: false });
    expect(fetchMock).toHaveBeenCalledWith('https://nextdo.example.com/api/claim/status');
  });

  it('returns { ok: true, claimed: true } when server is already claimed', async () => {
    mockFetch(200, { claimed: true });

    const result = await fetchClaimStatus(BACKEND_URL);

    expect(result).toEqual({ ok: true, claimed: true });
  });

  it('handles network failure gracefully without throwing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    const result = await fetchClaimStatus(BACKEND_URL);

    expect(result).toEqual({
      ok: false,
      kind: 'network',
      detail: 'network down',
    });
  });

  it('returns invalid when response body is not boolean claimed', async () => {
    mockFetch(200, { somethingElse: 123 });

    const result = await fetchClaimStatus(BACKEND_URL);

    expect(result).toEqual({ ok: false, kind: 'invalid' });
  });
});

describe('claimServer', () => {
  it('returns { ok: true, ownerToken } on successful claim', async () => {
    const fetchMock = mockFetch(200, { ok: true, ownerToken: 'generated-token-123' });

    const result = await claimServer(BACKEND_URL);

    expect(result).toEqual({ ok: true, ownerToken: 'generated-token-123' });
    expect(fetchMock).toHaveBeenCalledWith('https://nextdo.example.com/api/claim', {
      method: 'POST',
      headers: undefined,
      body: undefined,
    });
  });

  it('posts specified ownerToken if passed', async () => {
    const fetchMock = mockFetch(200, { ok: true, ownerToken: 'custom-token' });

    const result = await claimServer(BACKEND_URL, 'custom-token');

    expect(result).toEqual({ ok: true, ownerToken: 'custom-token' });
    expect(fetchMock).toHaveBeenCalledWith('https://nextdo.example.com/api/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownerToken: 'custom-token' }),
    });
  });

  it('returns already_claimed when response is 409', async () => {
    mockFetch(409, { error: 'already_claimed' });

    const result = await claimServer(BACKEND_URL);

    expect(result).toEqual({ ok: false, kind: 'already_claimed', status: 409 });
  });

  it('handles network errors without throwing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('failed to connect'));

    const result = await claimServer(BACKEND_URL);

    expect(result).toEqual({
      ok: false,
      kind: 'network',
      detail: 'failed to connect',
    });
  });
});
