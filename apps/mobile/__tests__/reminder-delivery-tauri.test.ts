/**
 * Integration test — the DESKTOP (tauri) delivery wiring
 * (hooks/use-reminder-delivery + lib/reminders/adapters/tauri): the
 * adapter is selected from `window.__TAURI_INTERNALS__` under
 * Platform.OS 'web', the 30 s tick runs the reconcile, a past-within-
 * grace row reaches the `plugin:notification|notify` IPC command with
 * the right title/body, and the session dedupe keeps it from re-firing.
 * Also covers the hardening: a FAILED invoke is NOT marked delivered, so
 * the next tick retries within the grace window.
 *
 * Platform.OS is forced to 'web' AT RUNTIME for this file only (the
 * jest-expo preset default is iOS → the native adapter) — via
 * Object.defineProperty, because a whole-module jest.mock of
 * 'react-native' collides with the RN jest preset's component mocks
 * (circular require during mock construction). The adapter and the hook
 * both read Platform.OS at call/effect time, so the runtime flip lands.
 * The tauri plugin module is mocked (it is ESM and is stubbed out of the
 * native bundle anyway); the IPC bridge is faked on
 * `window.__TAURI_INTERNALS__` (the adapter's direct-invoke path — see
 * the module doc of adapters/tauri.ts for why sendNotification is
 * bypassed).
 *
 * NOTE: the tauri adapter's fired-id set is MODULE LEVEL and survives
 * `__resetDeliveryAdapterForTests` (dispose is a no-op there) — the tests
 * below use DISTINCT reminder ids for that reason.
 */
import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';

const mockTauriInvoke = jest.fn(async (): Promise<undefined> => undefined);
jest.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: jest.fn(async () => true),
}));

const mockRouterReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
}));

const mockPowersync = {
  onChange: () => () => undefined,
};
jest.mock('@powersync/react', () => ({
  usePowerSync: () => mockPowersync,
}));

const mockRowsRef: { current: Array<Record<string, unknown>> } = { current: [] };
jest.mock('@nextdo/db', () => ({
  wrapDb: () => ({}),
  listScheduledReminders: jest.fn(async () => mockRowsRef.current),
}));

import { useReminderDelivery } from '@/hooks/use-reminder-delivery';
import { __resetDeliveryAdapterForTests, getDeliveryAdapter } from '@/lib/reminders/adapters';

const flush = async (): Promise<void> => {
  await act(async () => {});
};

function seedPastRow(reminderId: string): void {
  mockRowsRef.current = [
    {
      id: reminderId,
      kind: 'next',
      actionId: 'a-1',
      firesAt: new Date(Date.now() - 60_000).toISOString(), // 1 min past → grace
      intensity: 'normal',
      title: '测试行动',
    },
  ];
}

describe('desktop (tauri) delivery wiring', () => {
  let originalOS: string;

  beforeEach(() => {
    jest.useFakeTimers();
    mockTauriInvoke.mockReset();
    mockTauriInvoke.mockImplementation(async () => undefined);
    // The Tauri shell marker + the raw IPC bridge (adapters/index.ts
    // detection + the adapter's direct notify invoke).
    (globalThis as { window?: unknown }).window = {
      __TAURI_INTERNALS__: { invoke: mockTauriInvoke },
    };
    // The module-singleton adapter survives across tests.
    __resetDeliveryAdapterForTests();
    // Flip the platform to the webview surface (see the module doc).
    originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  });

  afterEach(() => {
    jest.useRealTimers();
    (globalThis as { window?: unknown }).window = undefined;
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  it('selects the tauri adapter under the tauri webview marker', () => {
    expect(getDeliveryAdapter().platform).toBe('tauri');
  });

  it('the mount reconcile delivers a past-within-grace row exactly once (tick dedupe)', async () => {
    seedPastRow('r-tick-1');
    renderHook(() => useReminderDelivery());
    await flush();

    // The FIRST reconcile (mount) already crosses fires_at → fires now.
    expect(mockTauriInvoke).toHaveBeenCalledTimes(1);
    expect(mockTauriInvoke).toHaveBeenCalledWith('plugin:notification|notify', {
      options: {
        title: '稍后提醒',
        body: '测试行动',
      },
    });

    // Two more ticks (60 s): the session dedupe keeps it from re-firing.
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    await flush();
    expect(mockTauriInvoke).toHaveBeenCalledTimes(1);
  });

  it('a failed send is retried by the next tick (not marked delivered)', async () => {
    seedPastRow('r-tick-2');
    mockTauriInvoke.mockRejectedValue(new Error('permission denied by OS'));
    renderHook(() => useReminderDelivery());
    await flush();

    expect(mockTauriInvoke).toHaveBeenCalledTimes(1);

    // The next tick: still inside the 5 min grace window → retry.
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    await flush();
    expect(mockTauriInvoke).toHaveBeenCalledTimes(2);
  });
});
