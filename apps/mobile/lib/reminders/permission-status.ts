/**
 * The native permission mapping (R5) — PURE (unit-tested per AC9, no
 * platform module imports): expo-notifications reports TWO levels of
 * status (the coarse root `granted/denied/undetermined` + the iOS-specific
 * one) and the app's three-state Settings model must normalize them.
 *
 * iOS is the tricky half (research §5):
 * - `PROVISIONAL` (quiet delivery to the notification center) and
 *   `EPHEMERAL` (delivered for ~4 h while the app runs) are USABLE —
 *   they count as granted (the official `settings.granted || ios.status
 *   === PROVISIONAL` example, generalized);
 * - only an explicit `DENIED` is denied (the root `status` alone reports
 *   `undetermined` for a fine-grained iOS state — the research flags the
 *   root status as unreliable on iOS);
 * - Android reports on the root status alone (`ios` is undefined).
 */

export type PermissionStatusValue = 'undetermined' | 'granted' | 'denied';

/**
 * The `Notifications.IosAuthorizationStatus` values (a numeric enum in
 * expo-notifications 57 — passed through as numbers so this helper stays
 * platform-module-free).
 */
export const IOS_AUTHORIZATION_STATUS = {
  NOT_DETERMINED: 0,
  DENIED: 1,
  AUTHORIZED: 2,
  PROVISIONAL: 3,
  EPHEMERAL: 4,
} as const;

export function resolvePermissionStatus(
  rootStatus: PermissionStatusValue,
  iosStatus: number | null | undefined,
): PermissionStatusValue {
  if (iosStatus === IOS_AUTHORIZATION_STATUS.DENIED) return 'denied';
  if (
    iosStatus === IOS_AUTHORIZATION_STATUS.AUTHORIZED ||
    iosStatus === IOS_AUTHORIZATION_STATUS.PROVISIONAL ||
    iosStatus === IOS_AUTHORIZATION_STATUS.EPHEMERAL
  ) {
    return 'granted';
  }
  // Android (iosStatus undefined) + iOS NOT_DETERMINED: the root status
  // is authoritative.
  return rootStatus;
}
