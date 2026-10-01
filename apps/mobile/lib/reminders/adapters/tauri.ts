/**
 * Tauri desktop adapter (design §4.2): the desktop webview runs the SAME
 * bundle as the web build; the tauri-plugin-notification commands only
 * exist when the Rust shell is present (selected by `window
 * .__TAURI_INTERNALS__` in `adapters/index.ts` — this module is never
 * instantiated on plain web, and Metro stubs it out of the native bundle).
 *
 * Hard constraints (research/tauri-plugin-notification.md, verified in
 * the 2.4.0 crate source):
 *
 * - Desktop has NO native scheduling: the plugin's `show()` is
 *   immediate-only and the `schedule` field is deserialized and never
 *   read. Delivery = the hook's 30 s tick + this adapter's `fireNow`
 *   (grace window in `reminder-scheduler.ts`). **The reminder never
 *   fires while the app is closed** — the v1 desktop limitation
 *   (documented; the Now screen shows the overdue action instead).
 * - Only `isPermissionGranted` / `sendNotification` are registered
 *   desktop commands. `pending` / `cancel` / `channels` / `
 *   onNotificationReceived` / … would reject with "command not found" —
 *   the API whitelist below is EXHAUSTIVE: do not add calls here.
 * - No click event and no payload read-back on desktop → tapping the
 *   notification just focuses/launches the app (D2's desktop
 *   degradation — no deep-link to the action).
 */
import { isPermissionGranted, sendNotification } from '@tauri-apps/plugin-notification';
import type { ReconcileOutput } from '../reminder-scheduler';
import type { DeliveryAdapter, ReminderPermissionState } from './types';
import { KIND_TITLES } from './types';

/**
 * Fired-id cap (design §4.2): the set bounds one desktop session; beyond
 * the cap the OLDEST id is evicted (a re-delivery of a very old reminder
 * is preferable to unbounded growth — the reconcile's other rules keep
 * duplicates from being a practical problem).
 */
const FIRED_IDS_MAX = 500;

/**
 * Session state, module level (the adapter is a module singleton — a
 * hook remount in dev must not reset the dedupe set and re-fire): the ids
 * delivered this launch + the launch moment.
 */
const firedIds = new Set<string>();
let sessionStart: Date | null = null;

function rememberFired(ids: string[]): void {
  for (const id of ids) firedIds.add(id);
  while (firedIds.size > FIRED_IDS_MAX) {
    const oldest = firedIds.values().next().value;
    if (oldest === undefined) break;
    firedIds.delete(oldest);
  }
}

export function createTauriAdapter(): DeliveryAdapter {
  return {
    platform: 'tauri',

    async init(): Promise<void> {
      // No OS setup exists on desktop (no channels, no click listener —
      // the plugin emits nothing there). Record the session start for the
      // reconcile's diagnostics.
      sessionStart ??= new Date();
    },

    async listPendingIds(): Promise<Set<string>> {
      // Desktop has no OS-side pending state (nothing persists across
      // restarts) — the reconcile's tauri mode ignores `toCancel` anyway.
      return new Set();
    },

    async apply(output: ReconcileOutput): Promise<void> {
      // toSchedule / toCancel are native-only (the pure reconcile never
      // produces them in tauri mode).
      for (const item of output.toFireNow) {
        // `sound` is intentionally NOT mapped (PRD R3): notify-rust's
        // desktop sound handling is platform-fragile — v1 plays the OS
        // default for every intensity tier.
        sendNotification({
          title: KIND_TITLES[item.row.kind],
          body: item.title,
        });
        rememberFired([item.row.id]);
      }
    },

    async permission(): Promise<ReminderPermissionState> {
      try {
        // The desktop Rust side ALWAYS reports granted (no prompt model);
        // it does NOT detect the user having disabled notifications in the
        // OS settings (macOS) — the Settings copy says "跟随系统设置".
        const granted = await isPermissionGranted();
        return {
          platform: 'tauri',
          status: granted ? 'granted' : 'denied',
          canAskAgain: false,
        };
      } catch {
        // Command missing = the shell lacks the notification plugin:
        // delivery is best-effort, report available (nothing to prompt).
        return { platform: 'tauri', status: 'granted', canAskAgain: false };
      }
    },

    async requestPermission(): Promise<ReminderPermissionState> {
      // Desktop: always granted, no prompt exists — same as permission().
      return this.permission();
    },

    async openSystemSettings(): Promise<void> {
      // No-op: the user manages desktop notifications in the OS settings
      // directly (the Settings block only shows text on tauri).
    },

    tauriContext(): { firedIds: ReadonlySet<string>; sessionStart: Date } {
      return { firedIds, sessionStart: sessionStart ?? new Date() };
    },

    dispose(): void {
      // Nothing to release (no listeners exist on desktop).
    },
  };
}
