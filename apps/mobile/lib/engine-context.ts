/**
 * Engine-context persistence (design.md §4.1): the Now screen's
 * `{ contextIds, availableMinutes }` survives restarts.
 *
 * Storage follows the owner-token platform matrix (the schema has NO
 * settings table — adding one would touch the sync surface, which this
 * task must not do):
 *   native (iOS/Android) → `expo-secure-store`
 *   browser web / Tauri → `localStorage` (persisted across sessions)
 *   Node / fallback → in-memory (re-selected after a restart)
 * Importing this file is safe on plain Node/jest (lazy backend selection,
 * the `expo-secure-store` require only runs on a native runtime).
 */
import { isReactNativeRuntime } from '@nextdo/db';
import { useCallback, useEffect, useRef, useState } from 'react';

export const ENGINE_CONTEXT_KEY = 'nextdo.settings.engine-context';

export interface EngineContextSettings {
  /** The scenes the user is in now; `[]` = anywhere (matches the engine
   *  contract: empty contextIds match any action context). */
  contextIds: string[];
  /** The time slot the user can give right now (minutes). */
  availableMinutes: number;
}

/** Scaffold defaults — the same values the vertical slice hardcoded. */
export const DEFAULT_ENGINE_CONTEXT: EngineContextSettings = { contextIds: [], availableMinutes: 60 };

const MAX_AVAILABLE_MINUTES = 1440;

interface KeyValue {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

function createMemoryStore(): KeyValue {
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
  };
}

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getWebLocalStorage(): WebStorageLike | null {
  const g = globalThis as {
    window?: { localStorage?: WebStorageLike };
    localStorage?: WebStorageLike;
  };
  return g.window?.localStorage ?? g.localStorage ?? null;
}

function isLocalStorageAvailable(): boolean {
  try {
    const storage = getWebLocalStorage();
    if (!storage) return false;
    const testKey = '__nextdo_probe__';
    storage.setItem(testKey, '1');
    storage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function createLocalStorageStore(): KeyValue {
  return {
    async getItem(key) {
      try {
        const storage = getWebLocalStorage();
        if (storage) {
          return storage.getItem(key);
        }
      } catch {
        // Fall back gracefully on storage access denied
      }
      return null;
    },
    async setItem(key, value) {
      try {
        const storage = getWebLocalStorage();
        if (storage) {
          storage.setItem(key, value);
          return;
        }
      } catch {
        // Ignore quota / security errors
      }
    },
  };
}

/** Keychain / Keystore — required lazily so plain Node never loads Expo. */
function createSecureStoreStore(): KeyValue {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const store = require('expo-secure-store') as {
    getItemAsync(key: string): Promise<string | null>;
    setItemAsync(key: string, value: string): Promise<void>;
  };
  return {
    getItem: (key) => store.getItemAsync(key),
    setItem: (key, value) => store.setItemAsync(key, value),
  };
}

let backend: KeyValue | null = null;
let cachedSettings: EngineContextSettings | null = null;
let pendingLoad: Promise<EngineContextSettings> | null = null;

function getBackend(): KeyValue {
  if (backend === null) {
    if (isReactNativeRuntime()) {
      backend = createSecureStoreStore();
    } else if (isLocalStorageAvailable()) {
      backend = createLocalStorageStore();
    } else {
      backend = createMemoryStore();
    }
  }
  return backend;
}

/** Test hook: point the module at a specific backend (null = reset). */
export function __setEngineContextStoreForTests(store: KeyValue | null): void {
  backend = store;
  cachedSettings = null;
  pendingLoad = null;
}

/**
 * Parse a stored blob; ANY corruption or missing field falls back to the
 * defaults (the setting must never take the Now screen down).
 */
export function parseEngineContext(raw: string | null): EngineContextSettings {
  if (raw === null) {
    return { contextIds: [], availableMinutes: DEFAULT_ENGINE_CONTEXT.availableMinutes };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return { contextIds: [], availableMinutes: DEFAULT_ENGINE_CONTEXT.availableMinutes };
    }
    const obj = parsed as { contextIds?: unknown; availableMinutes?: unknown };
    const contextIds = Array.isArray(obj.contextIds)
      ? obj.contextIds.filter((entry): entry is string => typeof entry === 'string')
      : [];
    const availableMinutes =
      typeof obj.availableMinutes === 'number' && Number.isFinite(obj.availableMinutes) && obj.availableMinutes >= 1
        ? Math.min(Math.round(obj.availableMinutes), MAX_AVAILABLE_MINUTES)
        : DEFAULT_ENGINE_CONTEXT.availableMinutes;
    return { contextIds, availableMinutes };
  } catch {
    return { contextIds: [], availableMinutes: DEFAULT_ENGINE_CONTEXT.availableMinutes };
  }
}

export async function loadEngineContext(): Promise<EngineContextSettings> {
  if (cachedSettings !== null) {
    return cachedSettings;
  }
  if (pendingLoad !== null) {
    return pendingLoad;
  }
  pendingLoad = getBackend()
    .getItem(ENGINE_CONTEXT_KEY)
    .then((raw) => {
      const parsed = parseEngineContext(raw);
      cachedSettings = parsed;
      pendingLoad = null;
      return parsed;
    })
    .catch((err: unknown) => {
      pendingLoad = null;
      throw err;
    });
  return pendingLoad;
}

export async function saveEngineContext(settings: EngineContextSettings): Promise<void> {
  cachedSettings = settings;
  await getBackend().setItem(
    ENGINE_CONTEXT_KEY,
    JSON.stringify({ contextIds: settings.contextIds, availableMinutes: settings.availableMinutes }),
  );
}

// ---------------------------------------------------------------------------
// React hook (design.md §5: read once, cache in memory, write-through)
// ---------------------------------------------------------------------------

export interface UseEngineContextSettingsResult {
  /** null until the first load settles (web/browser: nearly immediate). */
  settings: EngineContextSettings | null;
  error: string | null;
  /** Merge a partial patch, persist it (write-through), and update state. */
  update: (patch: Partial<EngineContextSettings>) => Promise<void>;
}

export function useEngineContextSettings(): UseEngineContextSettingsResult {
  const [settings, setSettings] = useState<EngineContextSettings | null>(cachedSettings);
  const [error, setError] = useState<string | null>(null);
  const settingsRef = useRef<EngineContextSettings | null>(cachedSettings);
  settingsRef.current = settings;

  // One load per mount — the value is cached in state thereafter.
  useEffect(() => {
    let cancelled = false;
    loadEngineContext()
      .then((loaded) => {
        if (cancelled) return;
        settingsRef.current = loaded;
        setSettings(loaded);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // A broken store must not take the Now screen down — fall back to
        // the scaffold defaults (writes will keep failing and re-surface).
        setSettings(DEFAULT_ENGINE_CONTEXT);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(async (patch: Partial<EngineContextSettings>) => {
    const current = settingsRef.current ?? DEFAULT_ENGINE_CONTEXT;
    // Clamp the way `parseEngineContext` does, so the live state and the
    // persisted blob agree (the store would otherwise hold 9999 while the
    // next load reads back 1440).
    const minutes = patch.availableMinutes ?? current.availableMinutes;
    const next: EngineContextSettings = {
      contextIds: patch.contextIds ?? current.contextIds,
      availableMinutes:
        typeof minutes === 'number' && Number.isFinite(minutes)
          ? Math.min(Math.max(Math.round(minutes), 1), MAX_AVAILABLE_MINUTES)
          : DEFAULT_ENGINE_CONTEXT.availableMinutes,
    };
    settingsRef.current = next;
    setSettings(next);
    try {
      await saveEngineContext(next);
      setError(null);
    } catch (err: unknown) {
      // State stays updated locally; the error is surfaced, the next write
      // retries the persistence.
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return { settings, error, update };
}
