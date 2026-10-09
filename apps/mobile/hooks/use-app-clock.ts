import { useEffect, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';

/**
 * The single app-level clock (spec: hook-guidelines Rule 4 — "All
 * time-sensitive logic receives `now` (from a single app-level clock hook
 * …which ticks on a minute interval) — hooks do not call `Date.now()`").
 *
 * Returns the current `Date`, re-evaluated once per minute as well as
 * immediately whenever the application returns to foreground (native
 * AppState 'active' or web window focus/visibility). Every time-sensitive
 * hook receives `now` from here; none call `Date.now()` themselves.
 */
const TICK_MS = 60 * 1000;

interface WebHostLike {
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
  document?: {
    visibilityState?: string;
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
  };
}

export function useAppClock(): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const updateNow = () => setNow(new Date());

    // 1. Minute tick interval
    const intervalId = setInterval(updateNow, TICK_MS);

    // 2. Web / Desktop focus and visibility listener
    if (Platform.OS === 'web') {
      const host = globalThis as WebHostLike;
      const doc = host.document;

      const onFocus = (): void => updateNow();
      const onVisibilityChange = (): void => {
        if (doc?.visibilityState === 'visible') {
          updateNow();
        }
      };

      host.addEventListener?.('focus', onFocus);
      doc?.addEventListener?.('visibilitychange', onVisibilityChange);

      return () => {
        clearInterval(intervalId);
        host.removeEventListener?.('focus', onFocus);
        doc?.removeEventListener?.('visibilitychange', onVisibilityChange);
      };
    }

    // 3. Native AppState 'active' listener
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') {
        updateNow();
      }
    });

    return () => {
      clearInterval(intervalId);
      subscription.remove();
    };
  }, []);

  return now;
}
