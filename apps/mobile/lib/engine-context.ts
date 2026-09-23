/**
 * Engine-context persistence (design.md §4.1): the Now screen's
 * `{ contextIds, availableMinutes }` survives restarts.
 *
 * Storage follows the owner-token platform matrix (the schema has NO
 * settings table — adding one would touch the sync surface, which this
 * task must not do):
 *   native (iOS/Android) → `expo-secure-store`
 *   browser web / Tauri / Node → in-memory (re-selected after a restart)
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

function getBackend(): KeyValue {
  if (backend === null) {
    backend = isReactNativeRuntime() ? createSecureStoreStore() : createMemoryStore();
  }
  return backend;
}

/** Test hook: point the module at a specific backend (null = reset). */
export function __setEngineContextStoreForTests(store: KeyValue | null): void {
  backend = store;
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
  return parseEngineContext(await getBackend().getItem(ENGINE_CONTEXT_KEY));
}

export async function saveEngineContext(settings: EngineContextSettings): Promise<void> {
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
  const [settings, setSettings] = useState<EngineContextSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settingsRef = useRef<EngineContextSettings | null>(null);
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
