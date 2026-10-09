/**
 * Owner-token + sync-backend-config storage — the ONLY place in the monorepo
 * that touches client-side secret storage (spec: app/database-guidelines.md
 * "PowerSync Rules" — the per-platform owner-token storage matrix).
 *
 * v1 is single-user: there is exactly one owner token, no account model
 * (the spec's account flow is post-MVP; the seam stays). The store holds TWO
 * known keys — the owner token (a secret) and the sync backend config
 * `{ backendUrl, endpoint }` (NOT a secret, but per-device configuration that
 * travels with the token so the app stays local-first: no stored config →
 * disconnected, pure local).
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
 * build output). The token and the backend config are entered by the user in
 * the app's settings screen or injected in dev/test via
 * `__setStorageBackendForTests`. The connector (powersync.ts) calls
 * `getOwnerToken()` — it never touches storage itself; the backend config is
 * read by the app's provider / settings hook, not by the connector.
 */
import { logger, StorageNextdoError, ValidationNextdoError } from '@nextdo/core';
import { isReactNativeRuntime, type NextdoPowerSyncConfig } from './powersync';

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Single-user v1: one token key, no per-user scoping. */
export const OWNER_TOKEN_KEY = 'nextdo.auth.owner-token';

/**
 * The user's sync-server config (`{ backendUrl, endpoint }`). NOT a secret —
 * it is per-device configuration stored alongside the token (same platform
 * matrix, same test seam). The value is the JSON stringification of a
 * `NextdoPowerSyncConfig` (see the "Sync backend config" section below).
 */
export const SYNC_CONFIG_KEY = 'nextdo.sync.config';

/** The stored backend config — the same shape the connector consumes. */
export type StoredBackendConfig = NextdoPowerSyncConfig;

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

/**
 * Encrypted local file (Tauri desktop) — the plugin is required lazily
 * so plain Node / browser never loads the Tauri IPC bridge.
 *
 * Written against the installed `@tauri-apps/plugin-stronghold@2.3.2`
 * VAULT API (shapes from `dist-js/index.d.ts`):
 *
 *   Stronghold.load(snapshotPath, password)   // lazy, cached per store
 *     → vault.loadClient('nextdo')            // existing snapshot
 *     → vault.createClient('nextdo')          // first run (fallback)
 *     → client.getStore().get / insert / remove
 *     → await vault.save()                    // after EVERY insert/remove
 *
 * The snapshot path is an ABSOLUTE path returned by the Rust command
 * `stronghold_snapshot_path` (apps/desktop/src-tauri/src/lib.rs) — the
 * plugin resolves a relative path against the process cwd, which would
 * drop the vault file into the source tree (dev) or the launcher's cwd
 * (release). The command is invoked through the `__TAURI_INTERNALS__`
 * bridge Tauri injects into the webview (no @tauri-apps/api import —
 * packages/db keeps no Tauri dependency of its own).
 *
 * The earlier draft targeted a file-based API (`init`/`createFile`/
 * `readFile`/`writeFile`/`deleteFile`) that does not exist in 2.3.2 —
 * that was the KNOWN DEFECT; this rewrite is the fix (prod-deploy R4).
 *
 * Snapshot password is a FIXED CONSTANT (design R4 trade-off, recorded in
 * the spec): the Rust side already initializes the plugin with Argon2 + an
 * app-data-dir salt, so the JS password only unlocks the vault ON THIS
 * MACHINE. v1 is single-user — the security boundary is "encrypted local
 * file" (same class as any other local desktop app's data), not cross-user
 * secrecy. A per-machine derived password is post-MVP.
 *
 * The vault is opened ONCE per store (the lazy promises below are
 * cached); the store itself is the module singleton behind getBackend(),
 * so in production the snapshot is loaded exactly once per app launch.
 */
function createStrongholdStore(): KeyValueStore {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Stronghold } = require('@tauri-apps/plugin-stronghold') as {
    Stronghold: {
      load(path: string, password: string): Promise<StrongholdVault>;
    };
  };

  /** The 2.3.2 vault surface this store uses (dist-js/index.d.ts). */
  interface StrongholdVaultStore {
    get(key: string): Promise<Uint8Array | null>;
    insert(key: string, value: number[]): Promise<void>;
    remove(key: string): Promise<Uint8Array | null>;
  }
  interface StrongholdVaultClient {
    getStore(): StrongholdVaultStore;
  }
  interface StrongholdVault {
    loadClient(client: string): Promise<StrongholdVaultClient>;
    createClient(client: string): Promise<StrongholdVaultClient>;
    save(): Promise<void>;
  }

  // Fixed constants (the trade-off above). The snapshot PATH is not a
  // constant: the Rust side owns it (`stronghold_snapshot_path` command).
  const SNAPSHOT_PASSWORD = 'nextdo-desktop-v1';
  // Single-user v1: one client, one store, TWO known keys (OWNER_TOKEN_KEY +
  // SYNC_CONFIG_KEY) — any other key is rejected (storage.multi-key).
  const CLIENT_NAME = 'nextdo';

  const encoder = new (
    globalThis as unknown as {
      TextEncoder: new () => { encode(input: string): Uint8Array };
    }
  ).TextEncoder();
  // TextEncoder/TextDecoder are standard globals: always present in the web
  // runtime this store targets (the Tauri webview), and in Hermes on
  // RN ≥ 0.85 (this repo pins RN 0.86). The app's TS lib is ES2022 without
  // DOM, so they are not declared here (packages/db's own typecheck sees
  // them via @types/node) — hence the typed globalThis view.
  const decoder = new (
    globalThis as unknown as {
      TextDecoder: new () => { decode(input: Uint8Array): string };
    }
  ).TextDecoder();

  let snapshotPathPromise: Promise<string> | null = null;
  function getSnapshotPath(): Promise<string> {
    if (snapshotPathPromise === null) {
      snapshotPathPromise = (async () => {
        // Tauri v2 injects the IPC bridge into the webview globals; the
        // command is registered in apps/desktop/src-tauri/src/lib.rs.
        const invoke = (
          globalThis as unknown as {
            __TAURI_INTERNALS__: { invoke(command: string): Promise<unknown> };
          }
        ).__TAURI_INTERNALS__.invoke;
        return (await invoke('stronghold_snapshot_path')) as string;
      })();
    }
    return snapshotPathPromise;
  }

  let vaultPromise: Promise<StrongholdVault> | null = null;
  function getVault(): Promise<StrongholdVault> {
    if (vaultPromise === null) {
      vaultPromise = getSnapshotPath()
        .then((snapshotPath) => Stronghold.load(snapshotPath, SNAPSHOT_PASSWORD))
        .catch((error) => {
          // A failed load must not poison the cache (a half-written
          // snapshot or a transient lock would brick every later read):
          // clear it so the next call retries the load.
          vaultPromise = null;
          throw error;
        });
    }
    return vaultPromise;
  }

  let storePromise: Promise<StrongholdVaultStore> | null = null;
  function getStore(): Promise<StrongholdVaultStore> {
    if (storePromise === null) {
      storePromise = getVault()
        .then((vault) =>
          // Existing snapshot → load the client. First run (fresh
          // snapshot, no client yet) → loadClient rejects → create it.
          vault
            .loadClient(CLIENT_NAME)
            .catch((error: unknown) => {
              logger.warn('stronghold: no existing client, creating', error);
              return vault.createClient(CLIENT_NAME);
            })
        )
        .then((client) => client.getStore())
        .catch((error) => {
          // Same non-poisoning rule as getVault.
          storePromise = null;
          throw error;
        });
    }
    return storePromise;
  }

  return {
    async getItem(key) {
      if (key !== OWNER_TOKEN_KEY && key !== SYNC_CONFIG_KEY) {
        return null;
      }
      const store = await getStore();
      // An empty vault / missing record resolves to null from store.get
      // itself — no error swallowing needed here.
      const bytes = await store.get(key);
      return bytes === null ? null : decoder.decode(bytes);
    },
    async setItem(key, value) {
      if (key !== OWNER_TOKEN_KEY && key !== SYNC_CONFIG_KEY) {
        throw new StorageNextdoError(
          'storage.multi-key',
          `stronghold store only holds ${OWNER_TOKEN_KEY} and ${SYNC_CONFIG_KEY}`,
        );
      }
      const [store, vault] = await Promise.all([getStore(), getVault()]);
      // 2.3.2 insert takes a byte array (number[]), not a string.
      await store.insert(key, Array.from(encoder.encode(value)));
      await vault.save(); // persist the mutation to the encrypted snapshot
    },
    async removeItem(key) {
      if (key !== OWNER_TOKEN_KEY && key !== SYNC_CONFIG_KEY) {
        return;
      }
      const [store, vault] = await Promise.all([getStore(), getVault()]);
      await store.remove(key);
      await vault.save();
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

/** Get the currently selected (or injected) key-value storage backend. */
export function getStorageBackend(): KeyValueStore {
  return getBackend();
}

/** Test hook: the currently selected (or injected) backend — lets tests
 *  drive the KeyValueStore contract directly (e.g. the multi-key
 *  rejection path, which the owner-token API never exercises). */
export function __getStorageBackendForTests(): KeyValueStore {
  return getBackend();
}

/* ------------------------------------------------------------------ *
 * Owner-token API (consumed by the connector; the app's settings
 * screen will call set/clear once it ships)
 * ------------------------------------------------------------------ */

/** The stored owner token, or null when none is stored (v1: the app keeps
 *  the PowerSync client disconnected — no sync — until a token is entered). */
export async function getOwnerToken(): Promise<string | null> {
  return getBackend().getItem(OWNER_TOKEN_KEY);
}

/**
 * Store the owner token the user entered (replaces any previous one).
 * Notifies subscribers (sign-in) after the write succeeds.
 */
export async function setOwnerToken(token: string): Promise<void> {
  if (token === '') {
    throw new ValidationNextdoError('auth.empty-token', 'owner token must be non-empty');
  }
  await getBackend().setItem(OWNER_TOKEN_KEY, token);
  notifyOwnerTokenChange();
}

/**
 * Forget the stored token (sign-out on all surfaces).
 * Notifies subscribers after the removal succeeds.
 */
export async function clearOwnerToken(): Promise<void> {
  await getBackend().removeItem(OWNER_TOKEN_KEY);
  notifyOwnerTokenChange();
}

/* ------------------------------------------------------------------ *
 * Sync backend config (the user's sync-server URLs, entered alongside
 * the token in the Settings tab). The address is NOT a secret, but it is
 * per-device configuration, so it travels with the token: same store, same
 * platform matrix, same test seam. No stored config → the provider keeps
 * PowerSync disconnected (pure local).
 *
 * Write order is the app's concern, not this layer's: `use-cloud-sync`
 * writes the config BEFORE the token, so the single token poke fires only
 * after both are stored. `setStoredBackendConfig` / `clearStoredBackendConfig`
 * therefore deliberately do NOT call notifyOwnerTokenChange.
 * ------------------------------------------------------------------ */

/** A stored backend URL must be a non-empty absolute http(s) URL. */
function isValidBackendUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** The stored backend config, or null when none is stored (or the stored
 *  value is corrupt — see below). Never throws: a corrupt value is treated
 *  as "not configured" (the recovery path is the user re-entering the
 *  addresses) so a bad write can never brick the settings screen. */
export async function getStoredBackendConfig(): Promise<StoredBackendConfig | null> {
  const raw = await getBackend().getItem(SYNC_CONFIG_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logger.warn('stored sync config is not valid JSON — treating as unset', error);
    return null;
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    typeof (parsed as { backendUrl?: unknown }).backendUrl === 'string' &&
    typeof (parsed as { endpoint?: unknown }).endpoint === 'string'
  ) {
    return {
      backendUrl: (parsed as { backendUrl: string }).backendUrl,
      endpoint: (parsed as { endpoint: string }).endpoint,
    };
  }
  logger.warn('stored sync config has an unexpected shape — treating as unset');
  return null;
}

/**
 * Store the backend config the user entered (replaces any previous one).
 * Validates both URLs (non-empty absolute http(s) — `sync.invalid-backend-url`
 * on violation) and writes the trimmed values. Does NOT notify
 * owner-token subscribers (write order is guaranteed by the caller — see
 * the section header).
 */
export async function setStoredBackendConfig(config: StoredBackendConfig): Promise<void> {
  const backendUrl = config.backendUrl.trim();
  const endpoint = config.endpoint.trim();
  if (!isValidBackendUrl(backendUrl) || !isValidBackendUrl(endpoint)) {
    throw new ValidationNextdoError(
      'sync.invalid-backend-url',
      'backendUrl and endpoint must each be an absolute http(s) URL',
    );
  }
  await getBackend().setItem(
    SYNC_CONFIG_KEY,
    JSON.stringify({ backendUrl, endpoint }),
  );
}

/**
 * Forget the stored backend config. v1 has no UI caller (disconnect only
 * clears the token and KEEPS the addresses so the user need not re-enter
 * them) — the API exists for tests and a future "reset server" action. Does
 * NOT notify owner-token subscribers.
 */
export async function clearStoredBackendConfig(): Promise<void> {
  await getBackend().removeItem(SYNC_CONFIG_KEY);
}

/* ------------------------------------------------------------------ *
 * Deriving the config from ONE server address (10-02-simplify-sync-setup)
 *
 * The Settings tab asks for a single 「服务器地址」; the two URLs the
 * connector needs follow mechanically from the deployment's path layout
 * (`/api` for the app backend, `/sync` for the PowerSync service). This
 * rule lives NEXT TO `setStoredBackendConfig` on purpose: the validation
 * below and the derivation must never disagree about what a valid config
 * is, and `apps/mobile` only calls it + renders.
 *
 * The server may also hand back its own `endpoint` from /credentials
 * (NEXTDO_SYNC_ENDPOINT) — a client without one falls back to the value
 * derived here, which is why this stays.
 * ------------------------------------------------------------------ */

/** Path segments stripped from the user's input before re-appending, so
 *  pasting a full address (`.../api`, `.../sync`) cannot produce
 *  `.../api/api`. Order matters: the longest first. */
const TOLERATED_SUFFIXES = ['/api', '/sync'] as const;

/**
 * Derive `{ backendUrl, endpoint }` from a single server address.
 *
 *   https://x.example.com        → { …/api,  …/sync }
 *   https://x.example.com/       → same (trailing slash stripped)
 *   https://x.example.com/api    → same (`/api` stripped, not doubled)
 *   https://x.example.com/sync   → same (`/sync` stripped, not doubled)
 *
 * Uses `new URL()` + pathname segment handling — never a regex, which
 * cannot see query strings, fragments or ports correctly. Every decision
 * is made on `url.origin` / `url.pathname`, never on the raw input
 * string: a pasted `.../api?ref=x` therefore still loses its `/api`
 * (a raw-string comparison would see `?ref=x` and emit `/api/api`).
 *
 * @throws ValidationNextdoError `sync.invalid-backend-url` when the input
 * is not an absolute http(s) URL (the same code `setStoredBackendConfig`
 * uses, so the UI has one message for the whole family).
 */
export function deriveSyncConfig(serverAddress: string): StoredBackendConfig {
  const trimmed = serverAddress.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ValidationNextdoError(
      'sync.invalid-backend-url',
      'server address must be an absolute http(s) URL',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationNextdoError(
      'sync.invalid-backend-url',
      'server address must be an absolute http(s) URL',
    );
  }
  // Work on the PARSED origin + pathname: `origin` is already
  // case-normalized by the URL parser, and the query string / fragment
  // the user pasted are simply not part of it (they belong to neither
  // endpoint).
  let prefix = url.pathname.replace(/\/+$/, '');
  for (const suffix of TOLERATED_SUFFIXES) {
    if (prefix.endsWith(suffix)) {
      prefix = prefix.slice(0, -suffix.length);
      break; // at most ONE suffix — `.../api/sync` is not a base we can repair
    }
  }
  return {
    backendUrl: `${url.origin}${prefix}/api`,
    endpoint: `${url.origin}${prefix}/sync`,
  };
}

/* ------------------------------------------------------------------ *
 * Owner-token change notification (sign-in / sign-out)
 *
 * The app's PowerSync provider subscribes here to drive connect()/
 * disconnect(). The PowerSync v2 SDK must only run its sync loop while an
 * owner token is present: `connect()` while signed out (fetchCredentials
 * -> null) makes its streamingSync loop retry buildRequest() forever and
 * log "Not signed in" every cycle. So the app connects when a token appears
 * and disconnects when it is cleared.
 * ------------------------------------------------------------------ */

/** A "poke" — the callback takes no arguments; re-read the current value
 *  with getOwnerToken() (the source of truth). */
type OwnerTokenChangeListener = () => void;

const ownerTokenChangeListeners = new Set<OwnerTokenChangeListener>();

function notifyOwnerTokenChange(): void {
  // Snapshot so a listener that unsubscribes (or adds one) mid-notify is safe.
  for (const listener of [...ownerTokenChangeListeners]) {
    try {
      listener();
    } catch {
      // A broken listener must never break an auth operation.
    }
  }
}

/**
 * Subscribe to owner-token changes (sign-in / sign-out). Returns an
 * unsubscribe function to call on teardown. The callback takes no arguments
 * — read the new value with getOwnerToken().
 */
export function subscribeToOwnerTokenChange(listener: OwnerTokenChangeListener): () => void {
  ownerTokenChangeListeners.add(listener);
  return () => {
    ownerTokenChangeListeners.delete(listener);
  };
}
