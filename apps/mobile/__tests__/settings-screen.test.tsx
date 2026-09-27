/**
 * The Settings tab's cloud-sync block (prod-deploy R6 — sync is OPTIONAL).
 *
 * Two layers:
 *  1. The root — there is NO first-launch gate anymore: with no stored
 *     token the app subtree (Inbox) renders directly; a stored token whose
 *     background startup check gets a 401 is silently cleared and the app
 *     STILL renders (the Settings block then reads 「未连接」).
 *  2. The Settings block — disconnected view (token input + 连接 + the R3
 *     three-state inline errors) and connected view (断开连接 → back to
 *     disconnected). Rendered via `renderRouter` against a mocked
 *     `@nextdo/db` boundary whose auth surface is mutable per test; the
 *     set/clear paths fire the SAME change notification as production, so
 *     the block flips exactly as it does in the app (the root layout's
 *     provider subscribes to it too — the mock supports multiple
 *     listeners, unlike the old single-listener gate test).
 */
type MockValidateResult =
  | { ok: true; token: string }
  | { ok: false; kind: 'rejected'; status: number }
  | { ok: false; kind: 'invalid' }
  | { ok: false; kind: 'network'; detail?: string };

const mockAuth: {
  storedToken: string | null;
  /** Per-test behavior of the /credentials round-trip. */
  validate: (config: unknown, token: string) => MockValidateResult;
} = {
  storedToken: null,
  // Default: permissive (accept anything). Overwritten per test.
  validate: () => ({ ok: true, token: 'ps-jwt' }),
};

const mockTokenListeners = new Set<() => void>();

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
    // --- the auth surface (mutable per test; multi-listener) ---
    getOwnerToken: async () => mockAuth.storedToken,
    fetchCredentialsOnce: async (config: unknown, token: string): Promise<MockValidateResult> =>
      mockAuth.validate(config, token),
    setOwnerToken: async (token: string) => {
      mockAuth.storedToken = token;
      mockNotifyTokenChange();
    },
    clearOwnerToken: async () => {
      mockAuth.storedToken = null;
      mockNotifyTokenChange();
    },
    subscribeToOwnerTokenChange: (listener: () => void) => {
      mockTokenListeners.add(listener);
      return () => {
        mockTokenListeners.delete(listener);
      };
    },
    // --- the standard shell mocks (tabs.smoke shape) ---
    createPowerSyncConnector: () => ({
      fetchCredentials: async () => null,
      uploadData: async () => undefined,
    }),
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

import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

/** The 连接 button's disabled state (Button sets accessibilityState). */
function connectButtonDisabled(): boolean {
  const button = screen.getByRole('button', { name: '连接' });
  return button.props.accessibilityState?.disabled === true;
}

/** Flush several microtask rounds (the auth chains are 3–4 promise hops
 *  deep: getOwnerToken → fetchCredentialsOnce → set/clear → notification
 *  → state re-read). */
async function flush(rounds = 8): Promise<void> {
  let p: Promise<unknown> = Promise.resolve();
  for (let i = 0; i < rounds; i++) {
    p = p.then(() => act(async () => {}));
  }
  await p;
}

beforeEach(() => {
  mockAuth.storedToken = null;
  mockAuth.validate = () => ({ ok: true, token: 'ps-jwt' });
  mockTokenListeners.clear();
});

/* ------------------------------------------------------------------ *
 * Root — no first-launch gate (R6)
 * ------------------------------------------------------------------ */
describe('root (no gate)', () => {
  it('no stored token → the app renders directly (no gate copy anywhere)', async () => {
    mockAuth.storedToken = null;

    renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await flush();

    expect(screen.getByText('清空大脑')).toBeTruthy();
    expect(screen.queryByText('连接你的服务器')).toBeNull();
    expect(mockAuth.storedToken).toBeNull();
  });

  it('stored token + startup check 401 → the token is silently cleared AND the app still renders', async () => {
    mockAuth.storedToken = 'stale-token';
    mockAuth.validate = () => ({ ok: false, kind: 'rejected', status: 401 });

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    expect(mockAuth.storedToken).toBeNull(); // the stale token was forgotten
    // …and the Settings block reads the cleared state as 「未连接」.
    expect(screen.getByText(/未连接/)).toBeTruthy();
    expect(screen.queryByText('断开连接')).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Settings — the cloud-sync block
 * ------------------------------------------------------------------ */
describe('settings cloud-sync block', () => {
  it('disconnected: shows the explanation, the token input and a disabled 连接 button', async () => {
    mockAuth.storedToken = null;

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    // 「设置」 appears in BOTH the header and the tab bar label — assert
    // the unique subtitle instead.
    expect(screen.getByText('设备与云同步。')).toBeTruthy();
    expect(screen.getByText('云同步')).toBeTruthy();
    expect(screen.getByText(/未连接/)).toBeTruthy();
    expect(screen.getByPlaceholderText('owner token')).toBeTruthy();
    expect(connectButtonDisabled()).toBe(true);
  });

  it('typing enables 连接; an empty token stays disabled', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    expect(connectButtonDisabled()).toBe(true);
    fireEvent.changeText(screen.getByPlaceholderText('owner token'), '   ');
    await flush();
    expect(connectButtonDisabled()).toBe(true);

    fireEvent.changeText(screen.getByPlaceholderText('owner token'), 'tok-1');
    await flush();
    expect(connectButtonDisabled()).toBe(false);
  });

  it('valid token → setOwnerToken (the OWNER token, trimmed) → the connected block', async () => {
    mockAuth.storedToken = null;
    mockAuth.validate = (_c, t) =>
      t === 'good-token' ? { ok: true, token: 'ps-jwt' } : { ok: false, kind: 'rejected', status: 401 };

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    fireEvent.changeText(screen.getByPlaceholderText('owner token'), '  good-token  ');
    await flush();
    fireEvent.press(screen.getByRole('button', { name: '连接' }));
    await flush();

    // The OWNER token was stored (not the minted service JWT)…
    expect(mockAuth.storedToken).toBe('good-token');
    // …and the same change notification that drives the provider's
    // connect() flips the block: connected view, the input is gone.
    expect(screen.getByRole('button', { name: '断开连接' })).toBeTruthy();
    expect(screen.getByText(/已连接/)).toBeTruthy();
    expect(screen.queryByPlaceholderText('owner token')).toBeNull();
  });

  it('401 → inline 「token 不正确」, stays disconnected, retry is possible', async () => {
    mockAuth.validate = () => ({ ok: false, kind: 'rejected', status: 401 });

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    fireEvent.changeText(screen.getByPlaceholderText('owner token'), 'bad-token');
    await flush();
    fireEvent.press(screen.getByRole('button', { name: '连接' }));
    await flush();

    expect(screen.getByText('token 不正确')).toBeTruthy();
    expect(mockAuth.storedToken).toBeNull();
    expect(screen.getByText(/未连接/)).toBeTruthy();

    // Retry: the second press calls validate again.
    const callsBefore = mockAuth.validate;
    let presses = 0;
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

    fireEvent.changeText(screen.getByPlaceholderText('owner token'), 'any-token');
    await flush();
    fireEvent.press(screen.getByRole('button', { name: '连接' }));
    await flush();

    expect(screen.getByText('连不上服务器，请稍后重试')).toBeTruthy();
    expect(mockAuth.storedToken).toBeNull();
    expect(screen.getByText(/未连接/)).toBeTruthy();
  });

  it('stored token → the connected block; 断开连接 → clearOwnerToken → back to disconnected', async () => {
    mockAuth.storedToken = 'good-token';
    mockAuth.validate = () => ({ ok: true, token: 'ps-jwt' });

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    expect(screen.getByRole('button', { name: '断开连接' })).toBeTruthy();
    expect(screen.queryByPlaceholderText('owner token')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: '断开连接' }));
    await flush();

    expect(mockAuth.storedToken).toBeNull();
    expect(screen.getByText(/未连接/)).toBeTruthy();
    expect(screen.getByPlaceholderText('owner token')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '断开连接' })).toBeNull();
  });
});
