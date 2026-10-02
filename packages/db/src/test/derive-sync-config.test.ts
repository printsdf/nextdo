/**
 * `deriveSyncConfig` — the ONE-address rule (10-02-simplify-sync-setup):
 * the Settings tab asks for a single 「服务器地址」 and this pure function
 * turns it into the `{ backendUrl, endpoint }` pair the connector needs
 * (`/api` for the app backend, `/sync` for the PowerSync service).
 *
 * Lives in owner-token.ts NEXT TO `setStoredBackendConfig` on purpose: the
 * derivation and the write-time validation must never disagree about what
 * a valid config is. These tests pin both halves of the contract — the
 * shapes a user actually types, and the tolerance for pasting a full
 * address (`/api`, `/sync`) without doubling the path.
 *
 * The derived output must always satisfy `setStoredBackendConfig`, which
 * is asserted explicitly at the bottom: derivation can never produce a
 * config the store would reject.
 */
import {
  __setStorageBackendForTests,
  deriveSyncConfig,
  getStoredBackendConfig,
  setStoredBackendConfig,
} from '../owner-token';

describe('deriveSyncConfig — the plain single address', () => {
  it('https://host → { /api, /sync }', () => {
    expect(deriveSyncConfig('https://nextdo.example.com')).toEqual({
      backendUrl: 'https://nextdo.example.com/api',
      endpoint: 'https://nextdo.example.com/sync',
    });
  });

  it('keeps the port (a LAN / loopback deployment)', () => {
    expect(deriveSyncConfig('http://192.168.1.10:8787')).toEqual({
      backendUrl: 'http://192.168.1.10:8787/api',
      endpoint: 'http://192.168.1.10:8787/sync',
    });
  });

  it('a plain http:// address is accepted (protocol ∈ {http:, https:})', () => {
    expect(deriveSyncConfig('http://localhost:8080').backendUrl).toBe('http://localhost:8080/api');
  });

  it('trims surrounding whitespace', () => {
    expect(deriveSyncConfig('  https://nextdo.example.com\n')).toEqual({
      backendUrl: 'https://nextdo.example.com/api',
      endpoint: 'https://nextdo.example.com/sync',
    });
  });
});

describe('deriveSyncConfig — trailing-slash and suffix tolerance', () => {
  it.each([
    ['a trailing slash', 'https://nextdo.example.com/'],
    ['several trailing slashes', 'https://nextdo.example.com///'],
    ['the full backend URL pasted in', 'https://nextdo.example.com/api'],
    ['the full backend URL with a trailing slash', 'https://nextdo.example.com/api/'],
    ['the full sync URL pasted in', 'https://nextdo.example.com/sync'],
    ['the full sync URL with a trailing slash', 'https://nextdo.example.com/sync/'],
  ])('%s derives the SAME config (never /api/api)', (_label, input) => {
    expect(deriveSyncConfig(input)).toEqual({
      backendUrl: 'https://nextdo.example.com/api',
      endpoint: 'https://nextdo.example.com/sync',
    });
  });

  it('preserves a sub-path prefix the deployment serves under', () => {
    expect(deriveSyncConfig('https://example.com/nextdo')).toEqual({
      backendUrl: 'https://example.com/nextdo/api',
      endpoint: 'https://example.com/nextdo/sync',
    });
  });

  it('preserves a sub-path prefix together with a stripped /api', () => {
    expect(deriveSyncConfig('https://example.com/nextdo/api')).toEqual({
      backendUrl: 'https://example.com/nextdo/api',
      endpoint: 'https://example.com/nextdo/sync',
    });
  });

  it('drops a query string / fragment the user pasted (neither belongs to the endpoints)', () => {
    expect(deriveSyncConfig('https://nextdo.example.com/?a=1#top')).toEqual({
      backendUrl: 'https://nextdo.example.com/api',
      endpoint: 'https://nextdo.example.com/sync',
    });
  });

  it.each([
    ['a query string', 'https://nextdo.example.com/api?ref=readme'],
    ['a fragment', 'https://nextdo.example.com/sync#frag'],
    ['both', 'https://nextdo.example.com/api?a=1#top'],
  ])('a pasted full URL carrying %s still loses its suffix (never /api/api)', (_label, input) => {
    // The suffix must be matched against the PARSED pathname, not the raw
    // input string — a string comparison would see `?ref=readme`, decide
    // the input does not end in `/api`, and emit `/api/api`.
    expect(deriveSyncConfig(input)).toEqual({
      backendUrl: 'https://nextdo.example.com/api',
      endpoint: 'https://nextdo.example.com/sync',
    });
  });

  it('normalizes a mixed-case host (the URL parser owns the canonical form)', () => {
    expect(deriveSyncConfig('https://Nextdo.Example.COM')).toEqual({
      backendUrl: 'https://nextdo.example.com/api',
      endpoint: 'https://nextdo.example.com/sync',
    });
  });

  it('strips at most ONE suffix — a path that already has both is not repairable', () => {
    // `.../api/sync` → the trailing `/sync` is dropped, `/api` is the
    // deployment's own prefix. Documented rather than silently guessed.
    expect(deriveSyncConfig('https://example.com/nextdo/api/sync')).toEqual({
      backendUrl: 'https://example.com/nextdo/api/api',
      endpoint: 'https://example.com/nextdo/api/sync',
    });
  });
});

describe('deriveSyncConfig — invalid input (sync.invalid-backend-url)', () => {
  const reject = (code: string) => expect.objectContaining({ name: 'ValidationNextdoError', code });

  it.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['a bare host with no scheme', 'nextdo.example.com'],
    ['a relative path', '/api'],
    ['a non-http(s) scheme', 'ftp://nextdo.example.com'],
    ['a websocket URL', 'wss://nextdo.example.com/sync'],
    ['plain text', 'not a url at all'],
  ])('%s → throws sync.invalid-backend-url', (_label, input) => {
    expect(() => deriveSyncConfig(input)).toThrow();
    let caught: unknown;
    try {
      deriveSyncConfig(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject(reject('sync.invalid-backend-url'));
  });

  it('shares the error code setStoredBackendConfig rejects with (one message family in the UI)', async () => {
    // The UI shows ONE copy for "the address you typed is not usable"; the
    // two functions must therefore reject under the same typed code.
    __setStorageBackendForTests(null);
    let fromDerive: unknown;
    let fromStore: unknown;
    try {
      deriveSyncConfig('nextdo.example.com');
    } catch (error) {
      fromDerive = error;
    }
    try {
      await setStoredBackendConfig({ backendUrl: 'nextdo.example.com', endpoint: 'https://x.example/sync' });
    } catch (error) {
      fromStore = error;
    }
    expect(fromDerive).toMatchObject(reject('sync.invalid-backend-url'));
    expect(fromStore).toMatchObject(reject('sync.invalid-backend-url'));
  });

  it('every derived config is ACCEPTED by setStoredBackendConfig (derivation cannot produce a rejected config)', async () => {
    __setStorageBackendForTests(null);
    const inputs = [
      'https://nextdo.example.com',
      'https://nextdo.example.com/',
      'https://nextdo.example.com/api',
      'https://nextdo.example.com/sync',
      'http://192.168.1.10:8787',
      'https://example.com/nextdo',
    ];
    for (const input of inputs) {
      // A rejection here would mean the derivation emitted something the
      // store refuses — the two halves of this contract must never drift.
      await expect(setStoredBackendConfig(deriveSyncConfig(input))).resolves.toBeUndefined();
    }
    await expect(getStoredBackendConfig()).resolves.toEqual({
      backendUrl: 'https://example.com/nextdo/api',
      endpoint: 'https://example.com/nextdo/sync',
    });
  });
});