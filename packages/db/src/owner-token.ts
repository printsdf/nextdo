/**
 * Owner-token storage — the ONLY place in the monorepo that touches
 * client-side secret storage (spec: app/database-guidelines.md
 * "PowerSync Rules" — the per-platform owner-token storage matrix).
 *
 * v1 is single-user: there is exactly one owner token, no account model
 * (the spec's account flow is post-MVP; the seam stays).
 *
 * The storage backend is chosen LAZILY on first use, exactly like
 * `loadPowerSyncClientModule()` in powersync.ts:
 *   iOS / Android (Expo native) → `expo-secure-store` (Keychain / Keystore)
 *   Tauri desktop (web runtime) → `@tauri-apps/plugin-stronghold`
 *                                (encrypted local file)
 *   browser web + plain Node    → in-memory ONLY (spec: the browser token
 *                                is re-entered after a restart; Node/jest
 *                                must import this file safely)
 * Importing this file is therefore safe on plain Node.
 *
 * No env-var fallback anywhere (spec: client env values may end up in the
 * build output). The token is entered by the user in the app's settings
 * screen (a later task) or injected in dev/test via
 * `__setStorageBackendForTests`. The connector (powersync.ts) calls
 * `getOwnerToken()` — it never touches storage itself.
 */
import { StorageNextdoError, ValidationNextdoError } from '@nextdo/core';
import { isReactNativeRuntime } from './powersync';

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Single-user v1: one key, no per-user scoping. */
export const OWNER_TOKEN_KEY = 'nextdo.auth.owner-token';

/* ------------------------------------------------------------------ *
 * Storage backends (lazy)
 * ------------------------------------------------------------------ */

/** In-memory store — browser web (spec) and plain Node/jest. State lives
 *  for the life of the process only. */
function createMemoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}

/** Keychain / Keystore (native Expo builds) — required lazily so plain
 *  Node never loads the Expo module. */
function createSecureStoreStore(): KeyValueStore {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const store = require('expo-secure-store') as {
    getItemAsync(key: string): Promise<string | null>;
    setItemAsync(key: string, value: string): Promise<void>;
    deleteItemAsync(key: string): Promise<void>;
  };
  return {
    getItem: (key) => store.getItemAsync(key),
    setItem: (key, value) => store.setItemAsync(key, value),
    removeItem: (key) => store.deleteItemAsync(key),
  };
}

/** Encrypted local file (Tauri desktop) — the plugin is required lazily
 *  so plain Node / browser never loads the Tauri IPC bridge.
 *
 *  KNOWN DEFECT (cannot be verified without a real Tauri build): the calls
 *  below target a file-based API (`init` / `createFile` / `readFile` /
 *  `writeFile` / `deleteFile`) that does NOT exist in the installed
 *  `@tauri-apps/plugin-stronghold@2.3.2`, whose real API is Ristretto's
 *  vault model (`Stronghold.load(path, password)` → `client.getStore()` →
 *  `store.insert/get/remove` + `stronghold.save()`). Jest never reaches this
 *  branch (plain Node → in-memory store), so the suite stays green; on a real
 *  desktop runtime it throws (and it sits on the `fetchCredentials` path via
 *  `getOwnerToken`). Rewrite against the 2.3.2 API as part of the
 *  runtime-owner-token task. */
function createStrongholdStore(): KeyValueStore {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Stronghold } = require('@tauri-apps/plugin-stronghold') as {
    Stronghold: {
      init(): Promise<void>;
      createFile(path: string, options?: { overwrite: boolean; permissions?: string }): Promise<void>;
      writeFile(path: string, content: string): Promise<void>;
      readFile(path: string): Promise<string>;
      deleteFile(path: string): Promise<void>;
    };
  };
  const FILE = 'nextdo/owner-token.txt';
  let ready = false;

  async function ensureReady(): Promise<void> {
    if (!ready) {
      await Stronghold.init();
      ready = true;
    }
  }

  const notFound = (error: unknown): boolean =>
    error instanceof Error && /no such file|not found/i.test(error.message);

  /** createFile(overwrite: false) — ignore the "already exists" error. */
  async function ensureFile(): Promise<void> {
    try {
      await Stronghold.createFile(FILE, { overwrite: false, permissions: '600' });
    } catch (error) {
      if (!/exists/i.test(String(error))) {
        throw error;
      }
    }
  }

  return {
    async getItem(key) {
      if (key !== OWNER_TOKEN_KEY) {
        return null;
      }
      await ensureReady();
      try {
        return await Stronghold.readFile(FILE);
      } catch (error) {
        if (notFound(error)) {
          return null;
        }
        throw error;
      }
    },
    async setItem(key, value) {
      if (key !== OWNER_TOKEN_KEY) {
        throw new StorageNextdoError(
          'storage.multi-key',
          `stronghold store only holds ${OWNER_TOKEN_KEY}`,
        );
      }
      await ensureReady();
      await ensureFile();
      await Stronghold.writeFile(FILE, value);
    },
    async removeItem(key) {
      if (key !== OWNER_TOKEN_KEY) {
        return;
      }
      await ensureReady();
      try {
        await Stronghold.deleteFile(FILE);
      } catch (error) {
        if (!notFound(error)) {
          throw error;
        }
      }
    },
  };
}

/** Tauri v2 injects `__TAURI_INTERNALS__` into the WebView — the standard
 *  runtime detection (no Tauri import needed at module scope). */
export function isTauriWebRuntime(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    ('__TAURI_INTERNALS__' in (globalThis as Record<string, unknown>))
  );
}

let backend: KeyValueStore | null = null;

function getBackend(): KeyValueStore {
  if (backend === null) {
    if (isReactNativeRuntime()) {
      backend = createSecureStoreStore();
    } else if (isTauriWebRuntime()) {
      backend = createStrongholdStore();
    } else {
      // Browser web (spec: in-memory only) + plain Node/jest.
      backend = createMemoryStore();
    }
  }
  return backend;
}

/** Test hook: point the module at a specific backend (e.g. a fresh
 *  in-memory store per test). Passing null resets to the lazy default. */
export function __setStorageBackendForTests(store: KeyValueStore | null): void {
  backend = store;
}

/* ------------------------------------------------------------------ *
 * Owner-token API (consumed by the connector; the app's settings
 * screen will call set/clear once it ships)
 * ------------------------------------------------------------------ */

/** The stored owner token, or null when none is stored (v1: the app
 *  shows the token-entry screen and the SDK stays disconnected). */
export async function getOwnerToken(): Promise<string | null> {
  return getBackend().getItem(OWNER_TOKEN_KEY);
}

/** Store the owner token the user entered (replaces any previous one). */
export async function setOwnerToken(token: string): Promise<void> {
  if (token === '') {
    throw new ValidationNextdoError('auth.empty-token', 'owner token must be non-empty');
  }
  await getBackend().setItem(OWNER_TOKEN_KEY, token);
}

/** Forget the stored token (sign-out on all surfaces). */
export async function clearOwnerToken(): Promise<void> {
  await getBackend().removeItem(OWNER_TOKEN_KEY);
}
