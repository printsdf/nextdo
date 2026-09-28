/**
 * Sync backend config storage (owner-token.ts "Sync backend config" section)
 * — the per-device sync-server URLs stored ALONGSIDE the owner token in the
 * same platform-keyed store. Runs against the DEFAULT backend on plain Node
 * (the in-memory store — `__setStorageBackendForTests(null)` re-selects it
 * fresh per test), which is exactly the contract the secure-store /
 * stronghold backends inherit (they are generic KV behind the same API).
 *
 * The stronghold-specific two-key contract (two known keys writable, a third
 * rejected) lives in stronghold-store.test.ts; here the API is exercised
 * end-to-end (validation, JSON codec, corrupt-value tolerance, and the
 * "does not poke the token subscribers" write-order guarantee).
 */
import {
  SYNC_CONFIG_KEY,
  __getStorageBackendForTests,
  __setStorageBackendForTests,
  clearStoredBackendConfig,
  getStoredBackendConfig,
  setStoredBackendConfig,
  subscribeToOwnerTokenChange,
} from '../owner-token';

beforeEach(() => {
  // Fresh in-memory store per test (Node is neither RN nor Tauri, so the
  // lazy default is the memory store — no __TAURI_INTERNALS__ in scope).
  __setStorageBackendForTests(null);
});

describe('round-trips (in-memory backend)', () => {
  it('set → get returns the stored config; clear → null', async () => {
    const config = { backendUrl: 'https://nextdo.example.com/api', endpoint: 'https://nextdo.example.com/sync' };
    await setStoredBackendConfig(config);
    await expect(getStoredBackendConfig()).resolves.toEqual(config);

    await clearStoredBackendConfig();
    await expect(getStoredBackendConfig()).resolves.toBeNull();
  });

  it('stores the TRIMMED values (trailing whitespace is normalized away)', async () => {
    await setStoredBackendConfig({
      backendUrl: '  https://nextdo.example.com/api  ',
      endpoint: 'https://nextdo.example.com/sync\n',
    });
    await expect(getStoredBackendConfig()).resolves.toEqual({
      backendUrl: 'https://nextdo.example.com/api',
      endpoint: 'https://nextdo.example.com/sync',
    });
  });

  it('accepts a plain http:// URL (protocol ∈ {http:, https:})', async () => {
    await setStoredBackendConfig({
      backendUrl: 'http://192.168.1.10:8787',
      endpoint: 'http://192.168.1.10:8000',
    });
    await expect(getStoredBackendConfig()).resolves.toEqual({
      backendUrl: 'http://192.168.1.10:8787',
      endpoint: 'http://192.168.1.10:8000',
    });
  });

  it('set replaces a previous config (single record)', async () => {
    await setStoredBackendConfig({ backendUrl: 'https://a.example/api', endpoint: 'https://a.example/sync' });
    await setStoredBackendConfig({ backendUrl: 'https://b.example/api', endpoint: 'https://b.example/sync' });
    await expect(getStoredBackendConfig()).resolves.toEqual({
      backendUrl: 'https://b.example/api',
      endpoint: 'https://b.example/sync',
    });
  });

  it('encodes the value as a JSON string under SYNC_CONFIG_KEY', async () => {
    const config = { backendUrl: 'https://nextdo.example.com/api', endpoint: 'https://nextdo.example.com/sync' };
    await setStoredBackendConfig(config);
    const raw = await __getStorageBackendForTests().getItem(SYNC_CONFIG_KEY);
    expect(raw).toBe(JSON.stringify(config));
  });
});

describe('validation (sync.invalid-backend-url)', () => {
  const reject = (code: string) =>
    expect.objectContaining({ name: 'ValidationNextdoError', code });

  it.each([
    ['empty backendUrl', { backendUrl: '', endpoint: 'https://nextdo.example.com/sync' }],
    ['whitespace-only backendUrl', { backendUrl: '   ', endpoint: 'https://nextdo.example.com/sync' }],
    ['empty endpoint', { backendUrl: 'https://nextdo.example.com/api', endpoint: '' }],
    ['ftp:// backendUrl', { backendUrl: 'ftp://x', endpoint: 'https://nextdo.example.com/sync' }],
    ['non-http(s) protocol endpoint', { backendUrl: 'https://nextdo.example.com/api', endpoint: 'ws://x' }],
    ['relative backendUrl', { backendUrl: 'example.com/api', endpoint: 'https://nextdo.example.com/sync' }],
    ['relative endpoint', { backendUrl: 'https://nextdo.example.com/api', endpoint: '/sync' }],
  ])('%s → throws and persists nothing', async (_label, config) => {
    await expect(setStoredBackendConfig(config as { backendUrl: string; endpoint: string })).rejects.toMatchObject(
      reject('sync.invalid-backend-url'),
    );
    // Nothing was written — the read is still null (a failed write leaves no
    // partial record).
    await expect(getStoredBackendConfig()).resolves.toBeNull();
  });
});

describe('corrupt stored value (recovery = re-enter)', () => {
  it('a non-JSON value → get resolves null (does not throw)', async () => {
    await __getStorageBackendForTests().setItem(SYNC_CONFIG_KEY, '{ definitely not json');
    await expect(getStoredBackendConfig()).resolves.toBeNull();
  });

  it('a JSON value with the wrong shape → get resolves null (does not throw)', async () => {
    await __getStorageBackendForTests().setItem(SYNC_CONFIG_KEY, JSON.stringify({ nope: true }));
    await expect(getStoredBackendConfig()).resolves.toBeNull();
  });
});

describe('write-order contract', () => {
  it('setStoredBackendConfig does NOT poke the owner-token subscribers', async () => {
    let pokes = 0;
    const unsubscribe = subscribeToOwnerTokenChange(() => {
      pokes += 1;
    });
    await setStoredBackendConfig({ backendUrl: 'https://a.example/api', endpoint: 'https://a.example/sync' });
    await clearStoredBackendConfig();
    expect(pokes).toBe(0);
    unsubscribe();
  });
});
