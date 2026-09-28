/**
 * The Settings tab's cloud-sync block (prod-deploy R6 — sync is OPTIONAL;
 * OSS task 09-28 — the server addresses are USER-CONFIGURED).
 *
 * Two layers:
 *  1. The root — there is NO first-launch gate: with no stored token the app
 *     subtree (Inbox) renders directly; a stored token + config whose
 *     background startup check gets a 401 clears the TOKEN (the stored
 *     addresses are KEPT) and the app STILL renders (the Settings block then
 *     reads 「未连接」 with the addresses pre-filled).
 *  2. The Settings block — disconnected view (backend address + sync-stream
 *     address + token inputs + 连接 + inline errors; the two address inputs
 *     pre-fill from the stored config) and connected view (read-only address
 *     display + 断开连接 → back to disconnected, addresses retained).
 *
 * Rendered via `renderRouter` against a mocked `@nextdo/db` boundary whose
 * auth + config surface is mutable per test; the set/clear paths fire the
 * SAME change notification as production (the token write is the single poke;
 * the config write is NOT — same as production).
 *
 * The button's `canSubmit` requires all three fields non-empty, so the two
 * client-side validations it cannot reach (empty token / empty address) are
 * exercised through the REAL `useCloudSync` hook via a tiny render harness —
 * asserting the inline copy AND that no network round-trip happened
 * (fetchCredentialsOnce spy count). The ftp:// (invalid, but non-empty) case
 * IS reachable through the button and is tested the same way.
 */
type MockValidateResult =
  | { ok: true; token: string }
  | { ok: false; kind: 'rejected'; status: number }
  | { ok: false; kind: 'invalid' }
  | { ok: false; kind: 'network'; detail?: string };

/** A valid stored / typed config used across the cases. */
const VALID_CONFIG = {
  backendUrl: 'https://nextdo.example.com/api',
  endpoint: 'https://nextdo.example.com/sync',
};

const mockAuth: {
  storedToken: string | null;
  storedConfig: { backendUrl: string; endpoint: string } | null;
  /** Per-test behavior of the /credentials round-trip. */
  validate: (config: unknown, token: string) => MockValidateResult;
} = {
  storedToken: null,
  storedConfig: null,
  // Default: permissive (accept anything). Overwritten per test.
  validate: () => ({ ok: true, token: 'ps-jwt' }),
};

const mockTokenListeners = new Set<() => void>();

/** Count of fetchCredentialsOnce calls (asserts the no-network contract). */
let mockFetchCalls = 0;

/** The configs passed to createPowerSyncConnector (the provider is the
 *  only caller — the acceptance check "provider connects WITH the stored
 *  config"). Collected on the @nextdo/db powersync instance, NOT the
 *  @powersync/react context mock the screens consume. */
let mockConnectorConfigs: unknown[] = [];

// (name starts with `mock` — jest.mock factories may only reference
// out-of-scope variables with that prefix)
function mockNotifyTokenChange(): void {
  for (const listener of [...mockTokenListeners]) {
    listener();
  }
}

jest.mock('@nextdo/db', () => {
  const compilable = () => ({
    compile: () => ({ sql: 'SELECT 1', parameters: [] }),
    execute: async () => [],
  });
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    disconnect: async () => undefined,
    close: async () => undefined,
  };
  return {
    createPowerSyncDatabase: () => powersync,
    // --- the auth + config surface (mutable per test; multi-listener) ---
    getOwnerToken: async () => mockAuth.storedToken,
    getStoredBackendConfig: async () => mockAuth.storedConfig,
    fetchCredentialsOnce: async (config: unknown, token: string): Promise<MockValidateResult> => {
      mockFetchCalls += 1;
      return mockAuth.validate(config, token);
    },
    setOwnerToken: async (token: string) => {
      mockAuth.storedToken = token;
      mockNotifyTokenChange();
    },
    clearOwnerToken: async () => {
      mockAuth.storedToken = null;
      mockNotifyTokenChange();
    },
    // Config write: syncs the stored config and does NOT poke (production
    // behavior — the token write is the single notification).
    setStoredBackendConfig: async (config: { backendUrl: string; endpoint: string }) => {
      mockAuth.storedConfig = {
        backendUrl: config.backendUrl.trim(),
        endpoint: config.endpoint.trim(),
      };
    },
    clearStoredBackendConfig: async () => {
      mockAuth.storedConfig = null;
    },
    subscribeToOwnerTokenChange: (listener: () => void) => {
      mockTokenListeners.add(listener);
      return () => {
        mockTokenListeners.delete(listener);
      };
    },
    // --- the standard shell mocks (tabs.smoke shape) ---
    createPowerSyncConnector: (config: unknown) => {
      mockConnectorConfigs.push(config);
      return {
        fetchCredentials: async () => null,
        uploadData: async () => undefined,
      };
    },
    subscribeAppStream: async () => undefined,
    wrapDb: () => ({}),
    seedDefaultContexts: async () => 0,
    isReactNativeRuntime: () => false,
    queryEnginePool: async () => ({ actions: [], calendar: [], projects: [] }),
    poolTriggerWatchQuery: compilable,
    inboxItemsWatchQuery: compilable,
    projectsWatchQuery: compilable,
    projectCardsWatchQuery: compilable,
    isStalled: () => false,
    reviewRecordsWatchQuery: compilable,
    skipAction: async () => undefined,
    completeAction: async () => undefined,
    snoozeAction: async () => undefined,
    trashAction: async () => undefined,
    addInboxItem: async () => undefined,
    trashInboxItem: async () => undefined,
    listInboxItems: async () => [],
    listProjects: async () => [],
    listProjectActions: async () => [],
    listContexts: async () => [],
    addContext: async () => undefined,
    listHabits: async () => [],
    listHabitDays: async () => [],
  };
});

jest.mock('@powersync/react', () => {
  const React = jest.requireActual('react');
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    close: async () => undefined,
  };
  // Stable identity across renders (the useQuery mock must not loop
  // recompute effects — same note as tabs.smoke.test.tsx).
  const queryResult = {
    data: [],
    isLoading: false,
    isFetching: false,
    error: undefined,
    refresh: async () => undefined,
  };
  return {
    PowerSyncContext: React.createContext(powersync),
    usePowerSync: () => powersync,
    useQuery: () => queryResult,
    useStatus: () => ({ status: 'synced', isSynced: true }),
  };
});

import { render } from '@testing-library/react-native';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { useCloudSync } from '@/hooks/use-cloud-sync';

/** A tiny harness that drives the REAL `useCloudSync` hook directly. The
 *  button's canSubmit (all three fields non-empty) blocks empty-token /
 *  empty-address submits, so the hook's own client-side validation for those
 *  cases is exercised here (and the no-network contract is asserted). */
let hook: ReturnType<typeof useCloudSync> | null = null;
function ConnectHarness() {
  // Test harness only: capture the hook's connect() for direct invocation.
  hook = useCloudSync();
  return null;
}

/** The 连接 button's disabled state (Button sets accessibilityState). */
function connectButtonDisabled(): boolean {
  const button = screen.getByRole('button', { name: '连接' });
  return button.props.accessibilityState?.disabled === true;
}

/** Flush several microtask rounds (the auth chains are 4–5 promise hops
 *  deep: getOwnerToken → getStoredBackendConfig → fetchCredentialsOnce →
 *  set/clear → notification → state re-read → prefill effect). */
async function flush(rounds = 10): Promise<void> {
  let p: Promise<unknown> = Promise.resolve();
  for (let i = 0; i < rounds; i++) {
    p = p.then(() => act(async () => {}));
  }
  await p;
}

beforeEach(() => {
  mockAuth.storedToken = null;
  mockAuth.storedConfig = null;
  mockAuth.validate = () => ({ ok: true, token: 'ps-jwt' });
  mockTokenListeners.clear();
  mockFetchCalls = 0;
  mockConnectorConfigs = [];
  hook = null;
});

/* ------------------------------------------------------------------ *
 * Root — no first-launch gate (R6)
 * ------------------------------------------------------------------ */
describe('root (no gate)', () => {
  it('no stored token → the app renders directly (no gate copy anywhere)', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await flush();

    expect(screen.getByText('清空大脑')).toBeTruthy();
    expect(screen.queryByText('连接你的服务器')).toBeNull();
    expect(mockAuth.storedToken).toBeNull();
  });

  it('stored token + config, startup check 401 → the token is cleared (config KEPT) AND the app still renders', async () => {
    mockAuth.storedToken = 'stale-token';
    mockAuth.storedConfig = { ...VALID_CONFIG };
    mockAuth.validate = () => ({ ok: false, kind: 'rejected', status: 401 });

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    expect(mockAuth.storedToken).toBeNull(); // the stale token was forgotten
    expect(mockAuth.storedConfig).toEqual(VALID_CONFIG); // …the addresses stay
    // …and the Settings block reads the cleared state as 「未连接」.
    expect(screen.getByText(/未连接/)).toBeTruthy();
    expect(screen.queryByText('断开连接')).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Settings — the cloud-sync block
 * ------------------------------------------------------------------ */
describe('settings cloud-sync block', () => {
  it('disconnected: shows the explanation, the three inputs and a disabled 连接 button', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    // 「设置」 appears in BOTH the header and the tab bar label — assert
    // the unique subtitle instead.
    expect(screen.getByText('设备与云同步。')).toBeTruthy();
    expect(screen.getByText('云同步')).toBeTruthy();
    expect(screen.getByText(/未连接/)).toBeTruthy();
    expect(screen.getByText(/填写你的同步服务器地址/)).toBeTruthy();
    expect(screen.getByPlaceholderText('https://nextdo.example.com/api')).toBeTruthy();
    expect(screen.getByPlaceholderText('https://nextdo.example.com/sync')).toBeTruthy();
    expect(screen.getByPlaceholderText('owner token')).toBeTruthy();
    expect(connectButtonDisabled()).toBe(true);
  });

  it('连接 enables only when all three fields are filled; an empty field stays disabled', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    expect(connectButtonDisabled()).toBe(true);
    // Token alone is not enough (the two addresses are still empty).
    fireEvent.changeText(screen.getByPlaceholderText('owner token'), 'tok-1');
    await flush();
    expect(connectButtonDisabled()).toBe(true);

    // Fill both addresses → enabled.
    fireEvent.changeText(
      screen.getByPlaceholderText('https://nextdo.example.com/api'),
      VALID_CONFIG.backendUrl,
    );
    fireEvent.changeText(
      screen.getByPlaceholderText('https://nextdo.example.com/sync'),
      VALID_CONFIG.endpoint,
    );
    await flush();
    expect(connectButtonDisabled()).toBe(false);
  });

  it('valid token + addresses → the config AND the (trimmed) owner token are stored → the connected block', async () => {
    mockAuth.validate = (_c, t) =>
      t === 'good-token' ? { ok: true, token: 'ps-jwt' } : { ok: false, kind: 'rejected', status: 401 };

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    fireEvent.changeText(
      screen.getByPlaceholderText('https://nextdo.example.com/api'),
      VALID_CONFIG.backendUrl,
    );
    fireEvent.changeText(
      screen.getByPlaceholderText('https://nextdo.example.com/sync'),
      VALID_CONFIG.endpoint,
    );
    fireEvent.changeText(screen.getByPlaceholderText('owner token'), '  good-token  ');
    await flush();
    fireEvent.press(screen.getByRole('button', { name: '连接' }));
    await flush();

    // The OWNER token was stored (not the minted service JWT)…
    expect(mockAuth.storedToken).toBe('good-token');
    // …AND the server addresses (both landed in the mock storage).
    expect(mockAuth.storedConfig).toEqual(VALID_CONFIG);
    // …and the same change notification that drives the provider's connect()
    // flips the block: connected view, read-only addresses, inputs gone.
    expect(screen.getByRole('button', { name: '断开连接' })).toBeTruthy();
    expect(screen.getByText(/已连接/)).toBeTruthy();
    expect(screen.getByText(/后端地址：/)).toBeTruthy();
    expect(screen.getByText(/同步流地址：/)).toBeTruthy();
    expect(screen.queryByPlaceholderText('owner token')).toBeNull();
    // …and the provider re-read [token, config] on the same poke and
    // connected WITH the stored config (acceptance: provider 以该 config
    // 调 connect — no hardcoded / stale config can sneak in).
    expect(mockConnectorConfigs).toEqual([VALID_CONFIG]);
  });

  it('401 → inline 「token 不正确」, stays disconnected, nothing is stored, retry is possible', async () => {
    mockAuth.validate = () => ({ ok: false, kind: 'rejected', status: 401 });

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    fireEvent.changeText(
      screen.getByPlaceholderText('https://nextdo.example.com/api'),
      VALID_CONFIG.backendUrl,
    );
    fireEvent.changeText(
      screen.getByPlaceholderText('https://nextdo.example.com/sync'),
      VALID_CONFIG.endpoint,
    );
    fireEvent.changeText(screen.getByPlaceholderText('owner token'), 'bad-token');
    await flush();
    fireEvent.press(screen.getByRole('button', { name: '连接' }));
    await flush();

    expect(screen.getByText('token 不正确')).toBeTruthy();
    expect(mockAuth.storedToken).toBeNull();
    expect(mockAuth.storedConfig).toBeNull(); // 401 stores nothing
    expect(screen.getByText(/未连接/)).toBeTruthy();

    // Retry: the second press calls validate again.
    let presses = 0;
    const callsBefore = mockAuth.validate;
    mockAuth.validate = (...args: [unknown, string]) => {
      presses += 1;
      return callsBefore(...args);
    };
    fireEvent.press(screen.getByRole('button', { name: '连接' }));
    await flush();
    expect(presses).toBe(1);
  });

  it('network failure → inline 「连不上服务器，请稍后重试」 (the token is NOT invalidated)', async () => {
    mockAuth.validate = () => ({ ok: false, kind: 'network', detail: 'ECONNREFUSED' });

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    fireEvent.changeText(
      screen.getByPlaceholderText('https://nextdo.example.com/api'),
      VALID_CONFIG.backendUrl,
    );
    fireEvent.changeText(
      screen.getByPlaceholderText('https://nextdo.example.com/sync'),
      VALID_CONFIG.endpoint,
    );
    fireEvent.changeText(screen.getByPlaceholderText('owner token'), 'any-token');
    await flush();
    fireEvent.press(screen.getByRole('button', { name: '连接' }));
    await flush();

    expect(screen.getByText('连不上服务器，请稍后重试')).toBeTruthy();
    expect(mockAuth.storedToken).toBeNull();
    expect(mockAuth.storedConfig).toBeNull();
    expect(screen.getByText(/未连接/)).toBeTruthy();
  });

  it('stored token + config → the connected block (addresses shown); 断开 → token cleared, config KEPT, addresses pre-filled', async () => {
    mockAuth.storedToken = 'good-token';
    mockAuth.storedConfig = { ...VALID_CONFIG };

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    expect(screen.getByRole('button', { name: '断开连接' })).toBeTruthy();
    expect(screen.getByText(/后端地址：/)).toBeTruthy();
    expect(screen.getByText(/同步流地址：/)).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: '断开连接' }));
    await flush();

    expect(mockAuth.storedToken).toBeNull();
    expect(mockAuth.storedConfig).toEqual(VALID_CONFIG); // addresses retained
    expect(screen.getByText(/未连接/)).toBeTruthy();
    // The address inputs are back AND pre-filled from the retained config.
    expect(screen.getByDisplayValue(VALID_CONFIG.backendUrl)).toBeTruthy();
    expect(screen.getByDisplayValue(VALID_CONFIG.endpoint)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '断开连接' })).toBeNull();
  });

  it('stored config (no token) → the disconnected view pre-fills the two address inputs', async () => {
    mockAuth.storedConfig = { ...VALID_CONFIG }; // no token → disconnected

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    expect(screen.getByText(/未连接/)).toBeTruthy();
    expect(screen.getByDisplayValue(VALID_CONFIG.backendUrl)).toBeTruthy();
    expect(screen.getByDisplayValue(VALID_CONFIG.endpoint)).toBeTruthy();
  });

  it('invalid address (ftp://) → inline 「地址无效…」 and fetchCredentialsOnce is NOT called', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    fireEvent.changeText(screen.getByPlaceholderText('https://nextdo.example.com/api'), 'ftp://files.example.com');
    fireEvent.changeText(
      screen.getByPlaceholderText('https://nextdo.example.com/sync'),
      VALID_CONFIG.endpoint,
    );
    fireEvent.changeText(screen.getByPlaceholderText('owner token'), 'tok-1');
    await flush();
    // All three are non-empty (ftp:// is a non-empty string), so 连接 is
    // enabled — the validity error comes from connect(), not the button.
    expect(connectButtonDisabled()).toBe(false);
    fireEvent.press(screen.getByRole('button', { name: '连接' }));
    await flush();

    expect(screen.getByText(/地址无效/)).toBeTruthy();
    expect(mockFetchCalls).toBe(0); // zero network round-trips
    expect(mockAuth.storedToken).toBeNull();
    expect(mockAuth.storedConfig).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * connect() client-side validation the button cannot reach (canSubmit
 * requires all three non-empty) — driven through the real hook.
 * ------------------------------------------------------------------ */
describe('connect() client-side validation (no network)', () => {
  it('empty token → 「token 不能为空」 and fetchCredentialsOnce is NOT called', async () => {
    render(<ConnectHarness />);
    const result = await act(async () =>
      hook!.connect({
        backendUrl: VALID_CONFIG.backendUrl,
        endpoint: VALID_CONFIG.endpoint,
        token: '   ',
      }),
    );
    expect(result).toEqual({ ok: false, message: 'token 不能为空' });
    expect(mockFetchCalls).toBe(0);
  });

  it('empty address → 「请先填写服务器地址」 and fetchCredentialsOnce is NOT called', async () => {
    render(<ConnectHarness />);
    const result = await act(async () =>
      hook!.connect({
        backendUrl: '  ',
        endpoint: VALID_CONFIG.endpoint,
        token: 'tok',
      }),
    );
    expect(result).toEqual({ ok: false, message: '请先填写服务器地址' });
    expect(mockFetchCalls).toBe(0);
  });
});
