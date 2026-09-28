/**
 * stronghold storage backend — the Tauri desktop branch of owner-token.ts
 * (prod-deploy R4). Mocks `@tauri-apps/plugin-stronghold` with the
 * 2.3.2 vault shapes (`Stronghold.load(path, password)` →
 * `loadClient`/`createClient` → `getStore().get/insert/remove` + `save`)
 * and simulates the snapshot on disk:
 *
 *   - `persisted` — what survives a process restart (only written by
 *     `vault.save()`);
 *   - `active` — the in-memory clients of the current "process";
 *   - `simulateRestart()` — drops `active`, keeps `persisted` (the app
 *     relaunched; the snapshot file is unchanged).
 *
 * The branch under test is the REAL selection path: `__TAURI_INTERNALS__`
 * is defined on globalThis, so `getBackend()` picks `createStrongholdStore`
 * (the lazy `require` hits the mock).
 */
import {
  __getStorageBackendForTests,
  __setStorageBackendForTests,
  clearOwnerToken,
  getOwnerToken,
  OWNER_TOKEN_KEY,
  setOwnerToken,
  SYNC_CONFIG_KEY,
} from '../owner-token';

/* ------------------------------------------------------------------ *
 * The mock — module state (the `mock` prefix is jest.mock's escape
 * hatch for referencing test scope from the hoisted factory).
 * ------------------------------------------------------------------ */

/** The absolute snapshot path the mock Rust command returns (the real
 *  one is `<app local data dir>/nextdo-stronghold` — see
 *  `stronghold_snapshot_path` in apps/desktop/src-tauri/src/lib.rs). */
const MOCK_SNAPSHOT_PATH = '/fake/app-data/nextdo-stronghold';

const mockVaultState = {
  /** Snapshot on disk: client → (key → bytes). Written by save() only. */
  persisted: new Map<string, Map<string, number[]>>(),
  /** In-memory clients of the current process: client → (key → bytes). */
  active: new Map<string, Map<string, number[]>>(),
  /** Every Stronghold.load call (path + password). */
  loadCalls: [] as Array<{ path: string; password: string }>,
  /** The vault object most recently returned by load (assert on its calls). */
  lastVault: null as null | {
    loadClient: jest.Mock;
    createClient: jest.Mock;
    save: jest.Mock;
  },
  reset(): void {
    this.persisted.clear();
    this.active.clear();
    this.loadCalls = [];
    this.lastVault = null;
  },
  /** App relaunch: drop the in-memory state, keep the snapshot. */
  simulateRestart(): void {
    this.active.clear();
  },
};

const mockCloneMap = (m: Map<string, number[]>): Map<string, number[]> =>
  new Map([...m.entries()].map(([k, v]) => [k, [...v]]));

jest.mock('@tauri-apps/plugin-stronghold', () => {
  const storeFor = (name: string): {
    get(key: string): Promise<Uint8Array | null>;
    insert(key: string, value: number[]): Promise<void>;
    remove(key: string): Promise<Uint8Array | null>;
  } => {
    const records = mockVaultState.active.get(name);
    return {
      async get(key) {
        const bytes = records?.get(key);
        return bytes === undefined ? null : new Uint8Array(bytes);
      },
      async insert(key, value) {
        records?.set(key, [...value]);
      },
      async remove(key) {
        const bytes = records?.get(key);
        records?.delete(key);
        return bytes === undefined ? null : new Uint8Array(bytes);
      },
    };
  };

  return {
    Stronghold: {
      load: jest.fn(async (path: string, password: string) => {
        mockVaultState.loadCalls.push({ path, password });
        const vault = {
          loadClient: jest.fn(async (name: string) => {
            const onDisk = mockVaultState.persisted.get(name);
            if (onDisk === undefined) {
              throw new Error(`client not found: ${name}`);
            }
            mockVaultState.active.set(name, mockCloneMap(onDisk));
            return { getStore: () => storeFor(name) };
          }),
          createClient: jest.fn(async (name: string) => {
            if (mockVaultState.persisted.has(name) || mockVaultState.active.has(name)) {
              throw new Error(`client already exists: ${name}`);
            }
            mockVaultState.active.set(name, new Map());
            return { getStore: () => storeFor(name) };
          }),
          save: jest.fn(async () => {
            // Persist every in-memory client (deep copy — the process can
            // keep mutating after the save).
            for (const [name, records] of mockVaultState.active) {
              mockVaultState.persisted.set(name, mockCloneMap(records));
            }
          }),
        };
        mockVaultState.lastVault = vault;
        return vault;
      }),
    },
  };
});

/* ------------------------------------------------------------------ *
 * Setup: the Tauri webview runtime flag + a fresh default backend per
 * test (the lazy selection then picks the stronghold store).
 * ------------------------------------------------------------------ */

let mockInvoke: jest.Mock;

beforeEach(() => {
  mockVaultState.reset();
  mockInvoke = jest.fn(async (command: string) => {
    if (command === 'stronghold_snapshot_path') {
      return MOCK_SNAPSHOT_PATH;
    }
    throw new Error(`unexpected command: ${command}`);
  });
  (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: mockInvoke };
  __setStorageBackendForTests(null);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
  __setStorageBackendForTests(null);
});

describe('branch selection + the fixed constants', () => {
  it('with __TAURI_INTERNALS__ the default backend loads the vault', async () => {
    await getOwnerToken();

    // The snapshot path comes from the Rust command (absolute — the
    // plugin would otherwise resolve it against the process cwd).
    expect(mockInvoke).toHaveBeenCalledWith('stronghold_snapshot_path');
    expect(mockVaultState.loadCalls).toHaveLength(1);
    expect(mockVaultState.loadCalls[0]).toEqual({
      path: MOCK_SNAPSHOT_PATH,
      password: 'nextdo-desktop-v1',
    });
  });

  it('the vault is loaded ONCE per store (lazy promise cache)', async () => {
    await getOwnerToken();
    await getOwnerToken();
    await setOwnerToken('tok-1');
    await getOwnerToken();

    expect(mockVaultState.loadCalls).toHaveLength(1);
  });
});

describe('first run (no client in the snapshot yet)', () => {
  it('loadClient rejects → createClient fallback (client "nextdo")', async () => {
    await setOwnerToken('tok-1');

    const vault = mockVaultState.lastVault;
    expect(vault).not.toBeNull();
    expect(vault!.loadClient).toHaveBeenCalledWith('nextdo');
    expect(vault!.createClient).toHaveBeenCalledWith('nextdo');
  });

  it('getItem returns null on the empty vault (no record yet)', async () => {
    await expect(getOwnerToken()).resolves.toBeNull();
  });
});

describe('get / set / remove round-trips', () => {
  it('set stores UTF-8 bytes; get decodes them back (TextEncoder/Decoder)', async () => {
    const token = 'tökén-中文-token';
    await setOwnerToken(token);
    await expect(getOwnerToken()).resolves.toBe(token);

    // The byte conversion happened at the plugin boundary: insert got the
    // exact UTF-8 bytes of the token (2.3.2 insert takes number[], not strings).
    const onDisk = mockVaultState.persisted.get('nextdo')?.get(OWNER_TOKEN_KEY);
    expect(onDisk).toEqual(Array.from(new TextEncoder().encode(token)));
  });

  it('setOwnerToken replaces the previous token (single record)', async () => {
    await setOwnerToken('tok-1');
    await setOwnerToken('tok-2');
    await expect(getOwnerToken()).resolves.toBe('tok-2');
  });

  it('removeItem drops the record; the next get returns null', async () => {
    await setOwnerToken('tok-1');
    await clearOwnerToken();
    await expect(getOwnerToken()).resolves.toBeNull();
    expect(mockVaultState.persisted.get('nextdo')?.has(OWNER_TOKEN_KEY)).toBe(false);
  });
});

describe('save() — persistence to the snapshot', () => {
  it('is called after every set AND every clear', async () => {
    await setOwnerToken('tok-1');
    const savesAfterSet = mockVaultState.lastVault!.save.mock.calls.length;
    expect(savesAfterSet).toBe(1);

    await clearOwnerToken();
    expect(mockVaultState.lastVault!.save.mock.calls.length).toBe(2);
  });

  it('a token reaches the on-disk snapshot (survives the process)', async () => {
    await setOwnerToken('tok-persist');
    expect(mockVaultState.persisted.get('nextdo')?.has(OWNER_TOKEN_KEY)).toBe(true);
  });
});

describe('restart (stronghold persistence)', () => {
  it('the stored token survives a relaunch via the persisted snapshot', async () => {
    await setOwnerToken('tok-restart');

    // Relaunch: in-memory state is gone, the snapshot file remains.
    mockVaultState.simulateRestart();
    __setStorageBackendForTests(null); // fresh store → a fresh Stronghold.load

    await expect(getOwnerToken()).resolves.toBe('tok-restart');

    // Second process → second load; the client now EXISTS on disk, so
    // loadClient succeeds and createClient is NOT needed.
    expect(mockVaultState.loadCalls).toHaveLength(2);
    expect(mockVaultState.lastVault!.loadClient).toHaveBeenCalledWith('nextdo');
    expect(mockVaultState.lastVault!.createClient).not.toHaveBeenCalled();
  });

  it('a clear before the relaunch is persisted too (sign-out survives)', async () => {
    await setOwnerToken('tok-1');
    mockVaultState.simulateRestart();
    __setStorageBackendForTests(null);
    await clearOwnerToken();
    mockVaultState.simulateRestart();
    __setStorageBackendForTests(null);
    await expect(getOwnerToken()).resolves.toBeNull();
  });
});

describe('the two-key contract (multi-key rejected)', () => {
  it('both known keys (owner token + sync config) are writable and coexist', async () => {
    const store = __getStorageBackendForTests();
    const configJson = '{"backendUrl":"https://a.example/api","endpoint":"https://a.example/sync"}';
    await store.setItem(OWNER_TOKEN_KEY, 'tok-1');
    await store.setItem(SYNC_CONFIG_KEY, configJson);

    // Both records persist to the encrypted snapshot side by side.
    expect(mockVaultState.persisted.get('nextdo')?.has(OWNER_TOKEN_KEY)).toBe(true);
    expect(mockVaultState.persisted.get('nextdo')?.has(SYNC_CONFIG_KEY)).toBe(true);
    // …and both read back through the store (UTF-8 decode).
    await expect(store.getItem(OWNER_TOKEN_KEY)).resolves.toBe('tok-1');
    await expect(store.getItem(SYNC_CONFIG_KEY)).resolves.toBe(configJson);
  });

  it('setItem for a foreign key throws storage.multi-key and writes nothing', async () => {
    const store = __getStorageBackendForTests();

    await expect(store.setItem('some.other.key', 'x')).rejects.toMatchObject({
      code: 'storage.multi-key',
    });
    // Nothing was written — not even the vault was touched for the write:
    expect(mockVaultState.persisted.get('nextdo')?.has('some.other.key')).toBeFalsy();
  });

  it('getItem for a foreign key returns null; removeItem is a no-op', async () => {
    const store = __getStorageBackendForTests();
    await expect(store.getItem('some.other.key')).resolves.toBeNull();
    await expect(store.removeItem('some.other.key')).resolves.toBeUndefined();
  });
});
