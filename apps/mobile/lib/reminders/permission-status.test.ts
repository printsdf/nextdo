/**
 * Unit tests — the native permission mapping (task 09-30 R5, AC9:
 * 权限状态助手单测). `resolvePermissionStatus` normalizes expo-notifications'
 * two-level status (coarse root + iOS-specific) into the app's three-state
 * Settings model. The iOS mapping is the tricky half: the root status alone
 * reports `undetermined` for fine-grained iOS states (the research flags it
 * as unreliable on iOS), so the iOS level wins when present.
 */
import { IOS_AUTHORIZATION_STATUS, resolvePermissionStatus } from './permission-status';

describe('resolvePermissionStatus — iOS (the ios level is present)', () => {
  it('an explicit iOS DENIED is denied — even when the root says granted', () => {
    expect(
      resolvePermissionStatus('granted', IOS_AUTHORIZATION_STATUS.DENIED),
    ).toBe('denied');
  });

  it('iOS AUTHORIZED is granted — even when the root says undetermined', () => {
    expect(
      resolvePermissionStatus('undetermined', IOS_AUTHORIZATION_STATUS.AUTHORIZED),
    ).toBe('granted');
  });

  it('iOS PROVISIONAL counts as granted (quiet delivery is usable)', () => {
    expect(
      resolvePermissionStatus('undetermined', IOS_AUTHORIZATION_STATUS.PROVISIONAL),
    ).toBe('granted');
  });

  it('iOS EPHEMERAL counts as granted (4 h delivery while the app runs)', () => {
    expect(
      resolvePermissionStatus('undetermined', IOS_AUTHORIZATION_STATUS.EPHEMERAL),
    ).toBe('granted');
  });

  it('iOS NOT_DETERMINED falls back to the root status', () => {
    expect(
      resolvePermissionStatus('undetermined', IOS_AUTHORIZATION_STATUS.NOT_DETERMINED),
    ).toBe('undetermined');
    expect(
      resolvePermissionStatus('denied', IOS_AUTHORIZATION_STATUS.NOT_DETERMINED),
    ).toBe('denied');
  });
});

describe('resolvePermissionStatus — Android / no iOS level', () => {
  it('the root status is authoritative when the iOS level is absent', () => {
    expect(resolvePermissionStatus('granted', undefined)).toBe('granted');
    expect(resolvePermissionStatus('denied', undefined)).toBe('denied');
    expect(resolvePermissionStatus('undetermined', undefined)).toBe('undetermined');
  });

  it('a null iOS level is treated as absent (defensive)', () => {
    expect(resolvePermissionStatus('granted', null)).toBe('granted');
    expect(resolvePermissionStatus('denied', null)).toBe('denied');
  });
});
