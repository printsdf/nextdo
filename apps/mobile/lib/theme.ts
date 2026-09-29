/**
 * Theme persistence and hook.
 *
 * Supports 'system' (default) | 'light' | 'dark'.
 * - Persisted via `expo-secure-store` on native, `localStorage` on web,
 *   in-memory fallback on plain Node / Jest.
 * - Synchronizes with NativeWind's `useColorScheme().setColorScheme(...)`.
 */
import { useCallback, useEffect, useState } from 'react';
import { useColorScheme as useNativeWindColorScheme } from 'nativewind';
import { isReactNativeRuntime } from '@nextdo/db';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCE_KEY = 'nextdo.settings.theme-preference';

interface KeyValue {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

interface WebStorageHost {
  localStorage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  };
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

function createStorage(): KeyValue {
  if (isReactNativeRuntime()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const store = require('expo-secure-store') as {
        getItemAsync(key: string): Promise<string | null>;
        setItemAsync(key: string, value: string): Promise<void>;
      };
      return {
        getItem: (key) => store.getItemAsync(key),
        setItem: (key, value) => store.setItemAsync(key, value),
      };
    } catch {
      return createMemoryStore();
    }
  }
  const host = globalThis as unknown as WebStorageHost;
  if (host.localStorage !== undefined) {
    const ls = host.localStorage;
    return {
      async getItem(key) {
        return ls.getItem(key);
      },
      async setItem(key, value) {
        ls.setItem(key, value);
      },
    };
  }
  return createMemoryStore();
}

const storage = createStorage();

export function useAppTheme() {
  const { colorScheme, setColorScheme } = useNativeWindColorScheme();
  const [preference, setPreference] = useState<ThemePreference>('system');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    storage.getItem(THEME_PREFERENCE_KEY).then((stored) => {
      if (cancelled) return;
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setPreference(stored);
        setColorScheme(stored);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [setColorScheme]);

  const updatePreference = useCallback(
    async (next: ThemePreference) => {
      setPreference(next);
      setColorScheme(next);
      await storage.setItem(THEME_PREFERENCE_KEY, next);
    },
    [setColorScheme],
  );

  const isDark = colorScheme === 'dark';

  return {
    preference,
    isDark,
    colorScheme,
    updatePreference,
    loaded,
  };
}
