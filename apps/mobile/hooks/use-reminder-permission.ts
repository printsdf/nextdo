/**
 * The Settings tab's notification status (R5) — a THIN read of the module
 * adapter's OS permission state. The root layout's `useReminderDelivery`
 * owns the delivery lifecycle; this hook only READS (the Settings screen
 * must render the block without re-running the engine), so it is its own
 * hook file (hook-guidelines Rule 1: one hook per file).
 *
 * The state refreshes on mount AND whenever the app returns to the
 * foreground (native AppState 'active' / webview 'focus') — that is when
 * the user comes back from the system Settings after toggling the
 * notification switch (AC6).
 *
 * Screen-facing copy stays in the screen (component-guidelines: screens
 * read hooks, never the platform modules — no expo-notifications import
 * here or in the screen).
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { getDeliveryAdapter, type ReminderPermissionState } from '@/lib/reminders/adapters';

export interface UseReminderPermissionResult {
  /** null until the first read resolves (the block renders 检查中…). */
  state: ReminderPermissionState | null;
  /** iOS (denied state): jump to this app's system notification settings;
   *  no-op on other platforms. */
  openSystemSettings: () => void;
  /** Request notification permission (supported on web/PWA and native). */
  requestPermission: () => Promise<ReminderPermissionState>;
}

export function useReminderPermission(): UseReminderPermissionResult {
  const adapter = getDeliveryAdapter();
  const [state, setState] = useState<ReminderPermissionState | null>(null);

  const refresh = useCallback(() => {
    void adapter
      .permission()
      .then((next) => setState(next))
      .catch(() => setState(null));
  }, [adapter]);

  useEffect(() => {
    refresh();
    if (Platform.OS === 'web') {
      const host = globalThis as {
        addEventListener?: (type: string, listener: () => void) => void;
        removeEventListener?: (type: string, listener: () => void) => void;
      };
      host.addEventListener?.('focus', refresh);
      return () => {
        host.removeEventListener?.('focus', refresh);
      };
    }
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') refresh();
    });
    return () => {
      subscription.remove();
    };
  }, [refresh]);

  const openSystemSettings = useCallback(() => {
    void adapter.openSystemSettings();
  }, [adapter]);

  const requestPermission = useCallback(async () => {
    const next = await adapter.requestPermission();
    setState(next);
    return next;
  }, [adapter]);

  return { state, openSystemSettings, requestPermission };
}
