/**
 * The Settings tab's cloud-sync block (prod-deploy R6 — sync is OPTIONAL;
 * OSS task 09-28 — the server addresses are USER-CONFIGURED; the owner
 * token is REQUIRED — connect() refuses an empty token with an inline
 * error before any network).
 *
 * Two layers:
 *  1. The root — there is NO first-launch gate: with no stored token the app
 *     subtree (Inbox) renders directly; a stored token + config whose
 *     background startup check gets a 401 clears the TOKEN (the stored
 *     addresses are KEPT) and the app STILL renders (the Settings block then
 *     reads 「未连接」 with the addresses pre-filled).
 *  2. The Settings block — disconnected view (ONE 「服务器地址」 input +
 *     ONE 「连接串 / owner token」 input + 连接 + inline errors; a collapsed
 *     「高级设置」 accordion holding the two custom URL inputs) and
 *     connected view (read-only address display + 断开连接 → back to
 *     disconnected, addresses retained).
 *
 * Rendered via `renderRouter` against a mocked `@nextdo/db` boundary whose
 * auth + config surface is mutable per test; the set/clear paths fire the
 * SAME change notification as production (the token write is the single poke;
 * the config write is NOT — same as production). `deriveSyncConfig` is the
 * REAL implementation (requireActual) so the derivation rule is not
 * re-implemented in the mock — its own exhaustive unit tests live in
 * packages/db/src/test/derive-sync-config.test.ts.
 *
 * The button's `canSubmit` requires the ADDRESS non-empty (an empty token is
 * a legal BUTTON PRESS — the token requirement is enforced by connect()
 * inline), so the validation the button cannot reach (empty address) is
 * exercised through the REAL `useCloudSync` hook via a tiny render harness —
 * asserting the inline copy AND that no network round-trip happened (the
 * fetchCredentialsOnce spy count). The ftp:// (invalid, but non-empty) case
 * IS reachable through the button and is tested the same way.
 */
type MockValidateResult =
  | { ok: true; token: string; endpoint?: string }
  | { ok: false; kind: 'rejected'; status: number }
  | { ok: false; kind: 'invalid' }
  | { ok: false; kind: 'network'; detail?: string };

/** The base server address the simple form produces VALID_CONFIG from. */
const SERVER_ADDRESS = 'https://nextdo.example.com';

/** A valid stored / derived config used across the cases. */
const VALID_CONFIG = {
  backendUrl: `${SERVER_ADDRESS}/api`,
  endpoint: `${SERVER_ADDRESS}/sync`,
};

/** Placeholders / labels — must match settings.tsx. */
const SERVER_PLACEHOLDER = 'https://nextdo.example.com';
const TOKEN_PLACEHOLDER = 'owner token 或连接串';
const BACKEND_PLACEHOLDER = 'https://nextdo.example.com/api';
const ENDPOINT_PLACEHOLDER = 'https://nextdo.example.com/sync';

const mockAuth: {
  storedToken: string | null;
  storedConfig: { backendUrl: string; endpoint: string } | null;
  claimStatus: boolean;
  claimToken: string;
  claimFails: boolean;
  /** Per-test behavior of the /credentials round-trip. */
  validate: (config: unknown, token: string) => MockValidateResult;
} = {
  storedToken: null,
  storedConfig: null,
  claimStatus: true,
  claimToken: 'auto-generated-token',
  claimFails: false,
  // Default: permissive (accept anything, no endpoint — the old-server
  // shape, which is what makes the fallback path the DEFAULT under test).
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
let mockClipboardString = '';

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async (text: string) => {
    mockClipboardString = text;
    return true;
  }),
}));

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
  // The REAL derivation rule (10-02): re-implementing it in the mock
  // would make these tests assert a second copy of the rule instead of
  // the one the hook actually calls. Its own exhaustive shape tests live
  // in packages/db/src/test/derive-sync-config.test.ts.
  const { deriveSyncConfig } = jest.requireActual('@nextdo/db') as {
    deriveSyncConfig: (address: string) => { backendUrl: string; endpoint: string };
  };
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    disconnect: async () => undefined,
    close: async () => undefined,
  };
  return {
    createPowerSyncDatabase: () => powersync,
    deriveSyncConfig,
    fetchClaimStatus: async () =>
      mockAuth.claimFails
        ? { ok: false, kind: 'network', detail: 'network down' }
        : { ok: true, claimed: mockAuth.claimStatus },
    claimServer: async () =>
      mockAuth.claimFails
        ? { ok: false, kind: 'network', detail: 'network down' }
        : { ok: true, ownerToken: mockAuth.claimToken },
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
    // The delivery hook's source query (task 09-30 — the root layout
    // mounts useReminderDelivery in every renderRouter test).
    listScheduledReminders: async () => [],
    seedDefaultContexts: async () => 0,
    isReactNativeRuntime: () => false,
    queryEnginePool: async () => ({ actions: [], calendar: [], projects: [] }),
    poolTriggerWatchQuery: compilable,
    inboxItemsWatchQuery: compilable,
    projectsWatchQuery: compilable,
    projectCardsWatchQuery: compilable,
    isStalled: () => false,
    reviewRecordsWatchQuery: compilable,
    waitingForWatchQuery: compilable,
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
    // The delivery hook subscribes to local changes (task 09-30) — a
    // no-op subscription in tests (the mocked queries never fire it).
    onChange: () => () => undefined,
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

// The root layout mounts the delivery engine (task 09-30) — jest runs as
// Platform 'ios', so the real native adapter drives expo-notifications
// (mocked: idle OS state — nothing pending, permission undetermined).
jest.mock('expo-notifications', () => mockExpoNotifications);

import { mockExpoNotifications } from './mocks/expo-notifications';

import { render } from '@testing-library/react-native';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { useCloudSync } from '@/hooks/use-cloud-sync';

/** A tiny harness that drives the REAL `useCloudSync` hook directly. The
 *  button's canSubmit (two addresses non-empty) blocks empty-address
 *  submits, and the empty-token branch is asserted here at the hook level
 *  too (the inline refusal, zero network, nothing stored). */
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

/** Expand the collapsed 「高级设置」 accordion (the custom URL inputs). */
async function expandAdvanced(): Promise<void> {
  if (screen.queryByPlaceholderText(SERVER_PLACEHOLDER) !== null) return;
  fireEvent.press(screen.getByRole('button', { name: '高级设置' }));
  await flush();
}

/** Fill the simple form: the one server address + the token / connection string. */
async function fillSimpleForm(address: string, token: string): Promise<void> {
  if (address !== '') {
    await expandAdvanced();
    fireEvent.changeText(screen.getByPlaceholderText(SERVER_PLACEHOLDER), address);
  }
  fireEvent.changeText(screen.getByPlaceholderText(TOKEN_PLACEHOLDER), token);
  await flush();
}

/** Fill the advanced form's two custom URLs (the accordion must be expanded). */
async function fillAdvancedForm(backendUrl: string, endpoint: string): Promise<void> {
  await expandAdvanced();
  fireEvent.changeText(screen.getByPlaceholderText(BACKEND_PLACEHOLDER), backendUrl);
  fireEvent.changeText(screen.getByPlaceholderText(ENDPOINT_PLACEHOLDER), endpoint);
  await flush();
}

/** Press 连接 and flush the whole auth chain. */
async function pressConnect(): Promise<void> {
  fireEvent.press(screen.getByRole('button', { name: '连接' }));
  await flush();
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
  mockAuth.claimStatus = true;
  mockAuth.claimToken = 'auto-generated-token';
  mockAuth.claimFails = false;
  mockAuth.validate = () => ({ ok: true, token: 'ps-jwt' });
  mockTokenListeners.clear();
  mockFetchCalls = 0;
  mockConnectorConfigs = [];
  mockClipboardString = '';
  hook = null;
  // Idle OS permission state (the notifications block tests override it
  // per case — task 09-30 R5).
  mockExpoNotifications.getPermissionsAsync.mockResolvedValue({
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
    expires: 'never',
  });
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
  it('disconnected: the explanation, ONE connection-string input, a collapsed 高级设置, and a disabled 连接 button', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    // 「设置」 appears in BOTH the header and the tab bar label — assert
    // the unique subtitle instead.
    expect(screen.getByText('设备与云同步。')).toBeTruthy();
    expect(screen.getByText('云同步')).toBeTruthy();
    expect(screen.getByText(/未连接/)).toBeTruthy();
    expect(screen.getByText(/填写你的同步服务器地址/)).toBeTruthy();
    // The simple form: primary connection-string input.
    expect(screen.getByPlaceholderText(TOKEN_PLACEHOLDER)).toBeTruthy();
    // Server address and custom URLs are in the accordion, COLLAPSED by default.
    expect(screen.getByRole('button', { name: '高级设置' })).toBeTruthy();
    expect(screen.queryByPlaceholderText(SERVER_PLACEHOLDER)).toBeNull();
    expect(screen.queryByPlaceholderText(BACKEND_PLACEHOLDER)).toBeNull();
    expect(screen.queryByPlaceholderText(ENDPOINT_PLACEHOLDER)).toBeNull();
    expect(connectButtonDisabled()).toBe(true);
  });

  it('连接 enables on a server address alone (token may be empty — the requirement is enforced by connect() inline); no address stays disabled', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    expect(connectButtonDisabled()).toBe(true);
    // Token alone is not enough (the address is still empty).
    fireEvent.changeText(screen.getByPlaceholderText(TOKEN_PLACEHOLDER), 'tok-1');
    await flush();
    expect(connectButtonDisabled()).toBe(true);

    // One address in advanced settings → enabled. The second URL is derived, never typed.
    await expandAdvanced();
    fireEvent.changeText(screen.getByPlaceholderText(SERVER_PLACEHOLDER), SERVER_ADDRESS);
    await flush();
    expect(connectButtonDisabled()).toBe(false);
  });

  it('ONE address + valid token → the derived config AND the (trimmed) owner token are stored → the connected block', async () => {
    mockAuth.validate = (_c, t) =>
      t === 'good-token' ? { ok: true, token: 'ps-jwt' } : { ok: false, kind: 'rejected', status: 401 };

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    await fillSimpleForm(SERVER_ADDRESS, '  good-token  ');
    await pressConnect();

    // The OWNER token was stored (not the minted service JWT)…
    expect(mockAuth.storedToken).toBe('good-token');
    // …AND the DERIVED addresses landed in the mock storage: the user
    // typed one field and both URLs exist.
    expect(mockAuth.storedConfig).toEqual(VALID_CONFIG);
    // …and the same change notification that drives the provider's connect()
    // flips the block: connected view, read-only addresses, inputs gone.
    expect(screen.getByRole('button', { name: '断开连接' })).toBeTruthy();
    expect(screen.getByText(/已连接/)).toBeTruthy();
    expect(screen.getByText(/后端地址：/)).toBeTruthy();
    expect(screen.getByText(/同步流地址：/)).toBeTruthy();
    expect(screen.queryByPlaceholderText(TOKEN_PLACEHOLDER)).toBeNull();
    // …and the provider re-read [token, config] on the same poke and
    // connected WITH the stored config (acceptance: provider 以该 config
    // 调 connect — no hardcoded / stale config can sneak in).
    expect(mockConnectorConfigs).toEqual([VALID_CONFIG]);
  });

  it.each([
    ['a trailing slash', `${SERVER_ADDRESS}/`],
    ['the full backend URL pasted in', VALID_CONFIG.backendUrl],
    ['the full sync URL pasted in', VALID_CONFIG.endpoint],
  ])('suffix tolerance: %s derives the SAME config (never /api/api)', async (_label, address) => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    await fillSimpleForm(address, 'good-token');
    await pressConnect();

    expect(mockAuth.storedConfig).toEqual(VALID_CONFIG);
    expect(mockAuth.storedToken).toBe('good-token');
  });

  it('empty token + claimed server → inline error directing user to scan QR code or enter token', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    mockAuth.claimStatus = true;
    await fillSimpleForm(SERVER_ADDRESS, '');
    expect(connectButtonDisabled()).toBe(false);
    await pressConnect();

    expect(
      screen.getByText('该服务器已绑定主人设备，请输入 owner token 或使用已配对设备扫码'),
    ).toBeTruthy();
    expect(mockAuth.storedToken).toBeNull();
    expect(mockAuth.storedConfig).toBeNull();
    expect(screen.getByText(/未连接/)).toBeTruthy();
    expect(screen.getByPlaceholderText(TOKEN_PLACEHOLDER)).toBeTruthy();
  });

  it('empty token on unclaimed server → auto-claims with generated token and lands in connected view with pairing options', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    mockAuth.claimStatus = false;
    mockAuth.claimToken = 'server-generated-64hex-token';

    await fillSimpleForm(SERVER_ADDRESS, '');
    await pressConnect();

    // Auto-claimed token is stored
    expect(mockAuth.storedToken).toBe('server-generated-64hex-token');
    expect(mockAuth.storedConfig).toEqual(VALID_CONFIG);

    // Transitions to connected block with pairing affordances
    expect(screen.getByText(/已连接/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '复制连接串' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '扫码配对' })).toBeTruthy();
  });

  /* ---------------- onboarding: mode switching & token guidance ---------------- */

  it('switching to 「自建服务器」 mode renders the server address as primary input without expanding advanced settings', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    // Default mode: pair (connection string input is visible, server address is hidden)
    expect(screen.getByPlaceholderText(TOKEN_PLACEHOLDER)).toBeTruthy();
    expect(screen.queryByPlaceholderText(SERVER_PLACEHOLDER)).toBeNull();

    // Switch to self_host mode
    fireEvent.press(screen.getByRole('button', { name: '模式：自建服务器' }));
    await flush();

    // Primary input is now the server address directly on the main surface
    expect(screen.getByPlaceholderText(SERVER_PLACEHOLDER)).toBeTruthy();
    expect(screen.queryByPlaceholderText(TOKEN_PLACEHOLDER)).toBeNull();
    expect(
      screen.getByText(/首台免密绑定：只需输入服务器地址，连接后自动生成密钥完成绑定/),
    ).toBeTruthy();

    // Can switch back to pair mode
    fireEvent.press(screen.getByRole('button', { name: '模式：连接串配对' }));
    await flush();

    expect(screen.getByPlaceholderText(TOKEN_PLACEHOLDER)).toBeTruthy();
    expect(screen.queryByPlaceholderText(SERVER_PLACEHOLDER)).toBeNull();
  });

  it('toggling 「什么是 Token 指引」 reveals and collapses detailed onboarding guidance', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    // The tutorial link is visible on disconnected view
    expect(screen.getByText(/查看 3 分钟零成本多端云同步教程/)).toBeTruthy();

    const guideBtn = screen.getByRole('button', { name: '什么是 Token 指引' });
    expect(guideBtn).toBeTruthy();
    expect(screen.queryByText(/1. 首台绑定/)).toBeNull();

    // Expand guide
    fireEvent.press(guideBtn);
    await flush();

    expect(screen.getByText(/1. 首台绑定/)).toBeTruthy();
    expect(screen.getByText(/2. 后续设备（多端同步配对）/)).toBeTruthy();
    expect(screen.getByText(/3. 零成本·纯网页搭建/)).toBeTruthy();

    // Collapse guide
    fireEvent.press(guideBtn);
    await flush();

    expect(screen.queryByText(/1. 首台绑定/)).toBeNull();
  });

  it('first device in 「自建服务器」 mode inputs address and connects with empty token → auto-claims seamlessly', async () => {
    mockAuth.claimStatus = false;
    mockAuth.claimToken = 'server-generated-claim-token-123';

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    // Switch to self_host mode
    fireEvent.press(screen.getByRole('button', { name: '模式：自建服务器' }));
    await flush();

    // Fill only the server address (token left completely empty)
    fireEvent.changeText(screen.getByPlaceholderText(SERVER_PLACEHOLDER), SERVER_ADDRESS);
    await flush();
    expect(connectButtonDisabled()).toBe(false);

    await pressConnect();

    expect(mockAuth.storedToken).toBe('server-generated-claim-token-123');
    expect(mockAuth.storedConfig).toEqual(VALID_CONFIG);
    expect(screen.getByText(/已连接/)).toBeTruthy();
  });

  it('user directly pastes plain Workers URL into primary token input → adaptively detects server address and connects via auto-claim', async () => {
    mockAuth.claimStatus = false;
    mockAuth.claimToken = 'server-generated-claim-token-adaptive';

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    // Default mode: pair. User directly inputs/pastes plain server URL into the token input
    expect(connectButtonDisabled()).toBe(true);
    fireEvent.changeText(screen.getByPlaceholderText(TOKEN_PLACEHOLDER), SERVER_ADDRESS);
    await flush();

    // Adaptive detection enables the connect button immediately
    expect(connectButtonDisabled()).toBe(false);

    await pressConnect();

    // Connects via auto-claim and stores the token and config
    expect(mockAuth.storedToken).toBe('server-generated-claim-token-adaptive');
    expect(mockAuth.storedConfig).toEqual(VALID_CONFIG);
    expect(screen.getByText(/已连接/)).toBeTruthy();
  });

  it('401 → inline 「token 不正确」, stays disconnected, nothing is stored, retry is possible', async () => {
    mockAuth.validate = () => ({ ok: false, kind: 'rejected', status: 401 });

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    await fillSimpleForm(SERVER_ADDRESS, 'bad-token');
    await pressConnect();

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
    await pressConnect();
    expect(presses).toBe(1);
  });

  it('network failure → inline 「连不上服务器，请稍后重试」 (the token is NOT invalidated)', async () => {
    mockAuth.validate = () => ({ ok: false, kind: 'network', detail: 'ECONNREFUSED' });

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    await fillSimpleForm(SERVER_ADDRESS, 'any-token');
    await pressConnect();

    expect(screen.getByText('连不上服务器，请稍后重试')).toBeTruthy();
    expect(mockAuth.storedToken).toBeNull();
    expect(mockAuth.storedConfig).toBeNull();
    expect(screen.getByText(/未连接/)).toBeTruthy();
  });

  it('the server-supplied endpoint OVERRIDES the derived one (10-02: the deployment owns the path)', async () => {
    mockAuth.validate = () => ({
      ok: true,
      token: 'ps-jwt',
      endpoint: 'https://custom.example.com/stream',
    });

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    await fillSimpleForm(SERVER_ADDRESS, 'good-token');
    await pressConnect();

    // backendUrl stays derived; endpoint is the server's.
    expect(mockAuth.storedConfig).toEqual({
      backendUrl: VALID_CONFIG.backendUrl,
      endpoint: 'https://custom.example.com/stream',
    });
    expect(mockAuth.storedToken).toBe('good-token');
    // …and the provider connects with that stored config.
    expect(mockConnectorConfigs).toEqual([
      {
        backendUrl: VALID_CONFIG.backendUrl,
        endpoint: 'https://custom.example.com/stream',
      },
    ]);
  });

  it('an OLD server (no endpoint in the 200 body) → the derived endpoint is kept (backward compatible)', async () => {
    mockAuth.validate = () => ({ ok: true, token: 'ps-jwt' }); // no endpoint

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    await fillSimpleForm(SERVER_ADDRESS, 'good-token');
    await pressConnect();

    expect(mockAuth.storedConfig).toEqual(VALID_CONFIG);
  });

  // NOTE: a MALFORMED server endpoint (`ftp://bad` → fall back to the
  // derived one) is deliberately NOT asserted here: the mock
  // `fetchCredentialsOnce` stands in for the real one, and the filtering
  // lives inside the real function — pinned by
  // packages/db/src/test/fetch-credentials-once.test.ts (the "omits
  // endpoint when it is malformed" cases) and connector.test.ts ("falls
  // back to the injected config when the server endpoint is malformed").
  // What this layer owns — `result.endpoint ?? config.endpoint` — IS
  // asserted by the two cases above.

  it('stored token + config → the connected block (addresses shown); 断开 → token cleared, config KEPT, address pre-filled', async () => {
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
    // The address inputs live in the advanced section, collapsed by default.
    await expandAdvanced();
    expect(screen.getByDisplayValue(SERVER_ADDRESS)).toBeTruthy();
    expect(screen.getByDisplayValue(VALID_CONFIG.backendUrl)).toBeTruthy();
    expect(screen.getByDisplayValue(VALID_CONFIG.endpoint)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '断开连接' })).toBeNull();
  });

  it('connected: clicking 复制连接串 copies <base>|<token> and updates button label to 已复制', async () => {
    mockAuth.storedToken = 'good-token';
    mockAuth.storedConfig = { ...VALID_CONFIG };

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    const copyBtn = screen.getByRole('button', { name: '复制连接串' });
    expect(copyBtn).toBeTruthy();

    fireEvent.press(copyBtn);
    await flush();

    expect(mockClipboardString).toBe(`${SERVER_ADDRESS}|good-token`);
    expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy();
  });

  it('connected: clicking 扫码配对 reveals the QR code with nextdo:// deep link, and hides on 收起二维码', async () => {
    mockAuth.storedToken = 'good-token';
    mockAuth.storedConfig = { ...VALID_CONFIG };

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    expect(screen.queryByLabelText('配对二维码')).toBeNull();
    const qrBtn = screen.getByRole('button', { name: '扫码配对' });
    expect(qrBtn).toBeTruthy();

    fireEvent.press(qrBtn);
    await flush();

    expect(screen.getByLabelText('配对二维码')).toBeTruthy();
    expect(screen.getByRole('button', { name: '收起二维码' })).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: '收起二维码' }));
    await flush();

    expect(screen.queryByLabelText('配对二维码')).toBeNull();
    expect(screen.getByRole('button', { name: '扫码配对' })).toBeTruthy();
  });

  it('a reconnect after 断开 needs ONLY a token — the prefilled advanced pair is reused as-is', async () => {
    mockAuth.storedConfig = { ...VALID_CONFIG }; // no token → disconnected
    mockAuth.validate = () => ({ ok: true, token: 'ps-jwt' });

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    fireEvent.changeText(screen.getByPlaceholderText(TOKEN_PLACEHOLDER), 'fresh-token');
    await flush();
    await pressConnect();

    expect(mockAuth.storedToken).toBe('fresh-token');
    // The prefilled advanced pair wins over the (identical) derivation —
    // a deployment with a custom path layout must survive a reconnect.
    expect(mockAuth.storedConfig).toEqual(VALID_CONFIG);
  });

  it('stored config (no token) → the disconnected view pre-fills the base address input', async () => {
    mockAuth.storedConfig = { ...VALID_CONFIG }; // no token → disconnected

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    expect(screen.getByText(/未连接/)).toBeTruthy();
    // The base address input lives in the advanced section
    await expandAdvanced();
    expect(screen.getByDisplayValue(SERVER_ADDRESS)).toBeTruthy();
    expect(screen.getByDisplayValue(VALID_CONFIG.backendUrl)).toBeTruthy();
  });

  it('invalid address (ftp://) → inline 「地址无效…」 and NO network round-trip', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    await fillSimpleForm('ftp://files.example.com', 'tok-1');
    // A non-empty address enables the button — the validity error comes
    // from connect(), not the button.
    expect(connectButtonDisabled()).toBe(false);
    await pressConnect();

    expect(screen.getByText(/地址无效/)).toBeTruthy();
    expect(mockFetchCalls).toBe(0); // zero network round-trips
    expect(mockAuth.storedToken).toBeNull();
    expect(mockAuth.storedConfig).toBeNull();
  });

  /* ---------------- 高级设置 (advanced, design D2) ---------------- */

  it('the advanced accordion reveals the two custom URL inputs', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    expect(screen.queryByPlaceholderText(BACKEND_PLACEHOLDER)).toBeNull();
    await expandAdvanced();
    expect(screen.getByPlaceholderText(BACKEND_PLACEHOLDER)).toBeTruthy();
    expect(screen.getByPlaceholderText(ENDPOINT_PLACEHOLDER)).toBeTruthy();
    // It toggles back.
    fireEvent.press(screen.getByRole('button', { name: '高级设置' }));
    await flush();
    expect(screen.queryByPlaceholderText(BACKEND_PLACEHOLDER)).toBeNull();
  });

  it('BOTH custom URLs filled → they win over the server address (no derivation)', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    await fillSimpleForm(SERVER_ADDRESS, 'good-token');
    await expandAdvanced();
    await fillAdvancedForm('https://other.example.com/api/v2', 'https://other.example.com/stream');

    await pressConnect();

    expect(mockAuth.storedConfig).toEqual({
      backendUrl: 'https://other.example.com/api/v2',
      endpoint: 'https://other.example.com/stream',
    });
  });

  it('the advanced pair alone is enough — the server address input may stay empty', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    await expandAdvanced();
    await fillAdvancedForm('https://other.example.com/api', 'https://other.example.com/sync');
    fireEvent.changeText(screen.getByPlaceholderText(TOKEN_PLACEHOLDER), 'good-token');
    await flush();
    expect(connectButtonDisabled()).toBe(false);
    await pressConnect();

    expect(mockAuth.storedConfig).toEqual({
      backendUrl: 'https://other.example.com/api',
      endpoint: 'https://other.example.com/sync',
    });
  });

  it('a HALF-filled advanced pair does NOT take over (falls back to the server address)', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    await fillSimpleForm(SERVER_ADDRESS, 'good-token');
    await expandAdvanced();
    // Only the backend URL typed — the pair is not complete, so the simple
    // form still applies (no half-config can ever be stored).
    await fillAdvancedForm('https://other.example.com/api', '');

    await pressConnect();

    expect(mockAuth.storedConfig).toEqual(VALID_CONFIG);
  });

  it('editing the server address after 断开 drops the prefilled advanced pair (the typed address wins)', async () => {
    // The regression this pins: a stored config pre-fills BOTH advanced
    // inputs, and `hasAdvanced` only asks "are both filled?" — so without
    // an explicit reset, a user changing servers would keep contacting the
    // OLD one while the field showed the NEW address, with no error
    // anywhere.
    mockAuth.storedConfig = { ...VALID_CONFIG };

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    // The stored pair is pre-filled (so 断开 → 重连 still needs only a token).
    await expandAdvanced();
    expect(screen.getByDisplayValue(VALID_CONFIG.backendUrl)).toBeTruthy();
    expect(screen.getByDisplayValue(VALID_CONFIG.endpoint)).toBeTruthy();

    // The user now points the app at a DIFFERENT server. That is an
    // explicit choice, so the advanced pair must step aside…
    fireEvent.changeText(
      screen.getByPlaceholderText(SERVER_PLACEHOLDER),
      'https://moved.example.com',
    );
    await flush();
    await expandAdvanced();
    expect(screen.queryByDisplayValue(VALID_CONFIG.backendUrl)).toBeNull();
    expect(screen.queryByDisplayValue(VALID_CONFIG.endpoint)).toBeNull();

    // …and the connect goes to the address actually typed.
    fireEvent.changeText(screen.getByPlaceholderText(TOKEN_PLACEHOLDER), 'fresh-token');
    await flush();
    await pressConnect();

    expect(mockAuth.storedToken).toBe('fresh-token');
    expect(mockAuth.storedConfig).toEqual({
      backendUrl: 'https://moved.example.com/api',
      endpoint: 'https://moved.example.com/sync',
    });
  });

  it('the prefilled advanced pair still wins when the address is NOT edited (custom layout survives)', async () => {
    // The counterpart to the case above: touching ONLY the token must keep
    // the stored custom pair, or a deployment with a non-standard path
    // layout would be silently rewritten to the derived one on reconnect.
    mockAuth.storedConfig = {
      backendUrl: 'https://custom.example.com/api/v2',
      endpoint: 'https://custom.example.com/stream',
    };
    mockAuth.validate = () => ({ ok: true, token: 'ps-jwt' });

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    fireEvent.changeText(screen.getByPlaceholderText(TOKEN_PLACEHOLDER), 'fresh-token');
    await flush();
    await pressConnect();

    expect(mockAuth.storedConfig).toEqual({
      backendUrl: 'https://custom.example.com/api/v2',
      endpoint: 'https://custom.example.com/stream',
    });
  });

  /* ---------------- connection strings ---------------- */

  it('a pasted plaintext connection string `<base>|<token>` connects (address field may be empty)', async () => {
    mockAuth.validate = (_c, t) =>
      t === 'abc123' ? { ok: true, token: 'ps-jwt' } : { ok: false, kind: 'rejected', status: 401 };

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    // The connection string carries BOTH halves — the address input stays empty.
    await fillSimpleForm('', `${SERVER_ADDRESS}|abc123`);
    expect(connectButtonDisabled()).toBe(false); // the string itself satisfies the address check
    await pressConnect();

    expect(mockAuth.storedToken).toBe('abc123');
    expect(mockAuth.storedConfig).toEqual(VALID_CONFIG);
  });

  it('a pasted nextdo:// deep link connects through the SAME path', async () => {
    mockAuth.validate = (_c, t) =>
      t === 'abc123' ? { ok: true, token: 'ps-jwt' } : { ok: false, kind: 'rejected', status: 401 };

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    await fillSimpleForm(
      '',
      'nextdo://sync?s=https%3A%2F%2Fnextdo.example.com&t=abc123',
    );
    expect(connectButtonDisabled()).toBe(false);
    await pressConnect();

    expect(mockAuth.storedToken).toBe('abc123');
    expect(mockAuth.storedConfig).toEqual(VALID_CONFIG);
  });

  it('a BARE token still works (the pre-existing behavior the parser preserves)', async () => {
    mockAuth.validate = (_c, t) =>
      t === 'abc123' ? { ok: true, token: 'ps-jwt' } : { ok: false, kind: 'rejected', status: 401 };

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    // Not a connection string → the field is read as a plain owner token,
    // and the server address comes from the address input as before.
    await fillSimpleForm(SERVER_ADDRESS, 'abc123');
    await pressConnect();

    expect(mockAuth.storedToken).toBe('abc123');
    expect(mockAuth.storedConfig).toEqual(VALID_CONFIG);
  });

  it('a connection string with a bad token → 401 copy, nothing stored (the string path shares the three states)', async () => {
    mockAuth.validate = () => ({ ok: false, kind: 'rejected', status: 401 });

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    await fillSimpleForm('', `${SERVER_ADDRESS}|wrong-token`);
    await pressConnect();

    expect(screen.getByText('token 不正确')).toBeTruthy();
    expect(mockAuth.storedToken).toBeNull();
    expect(mockAuth.storedConfig).toBeNull();
  });

  it('a malformed connection string (no address half) leaves the simple form in charge', async () => {
    mockAuth.validate = () => ({ ok: true, token: 'ps-jwt' });

    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    // `|tok` is not a connection string (no address), so it is read as a
    // BARE token — and the address comes from the address input.
    await fillSimpleForm(SERVER_ADDRESS, '|abc123');
    await pressConnect();

    expect(mockAuth.storedConfig).toEqual(VALID_CONFIG);
    // The half-parsed string was NOT mistaken for a token.
    expect(mockAuth.storedToken).toBe('|abc123');
  });
});

/* ------------------------------------------------------------------ *
 * Settings — notifications block (task 09-30 R5): the OS permission
 * state through useReminderPermission (the idle mock = undetermined;
 * per-case overrides drive the other two states).
 * ------------------------------------------------------------------ */
describe('settings notifications block (task 09-30 R5)', () => {
  it('undetermined → the 尚未授权 copy, no 去系统设置 button', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    expect(screen.getByText('提醒通知')).toBeTruthy();
    expect(screen.getByText(/尚未授权/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '去系统设置' })).toBeNull();
  });

  it('granted → the 已授权 copy', async () => {
    mockExpoNotifications.getPermissionsAsync.mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: true,
      expires: 'never',
    });
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    expect(screen.getByText(/已授权/)).toBeTruthy();
    expect(screen.queryByText(/尚未授权/)).toBeNull();
  });

  it('denied (iOS) → the 通知已被拒绝 copy + the 去系统设置 button', async () => {
    mockExpoNotifications.getPermissionsAsync.mockResolvedValue({
      status: 'denied',
      granted: false,
      canAskAgain: false,
      expires: 'never',
    });
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    expect(screen.getByText(/通知已被拒绝/)).toBeTruthy();
    // iOS under jest: the button (not the Android text guidance) renders.
    expect(screen.getByRole('button', { name: '去系统设置' })).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ *
 * connect() input branches the button cannot reach (canSubmit requires
 * an address; the token is required but NOT button-gated) — driven
 * through the real hook, for BOTH input shapes.
 * ------------------------------------------------------------------ */
describe('connect() input branches (button cannot reach)', () => {
  it('empty server address → 「请先填写服务器地址」 and /credentials is NOT called (address checks run first)', async () => {
    render(<ConnectHarness />);
    const result = await act(async () =>
      hook!.connect({
        serverAddress: '  ',
        token: '   ', // even an empty token must not fire any network call
      }),
    );
    expect(result).toEqual({ ok: false, message: '请先填写服务器地址' });
    expect(mockFetchCalls).toBe(0);
  });

  it('empty token + a valid server address (claimed) → guidance to scan or enter token', async () => {
    render(<ConnectHarness />);
    const result = await act(async () =>
      hook!.connect({ serverAddress: SERVER_ADDRESS, token: '   ' }),
    );
    expect(result).toEqual({
      ok: false,
      message: '该服务器已绑定主人设备，请输入 owner token 或使用已配对设备扫码',
    });
    expect(mockFetchCalls).toBe(0); // ZERO credentials fetch calls
    expect(mockAuth.storedConfig).toBeNull();
    expect(mockAuth.storedToken).toBeNull();
  });

  it('an invalid server address → 「地址无效…」 with ZERO network (the derivation rejects pre-network)', async () => {
    render(<ConnectHarness />);
    const result = await act(async () =>
      hook!.connect({ serverAddress: 'nextdo.example.com', token: 'tok' }),
    );
    expect(result).toEqual({ ok: false, message: '地址无效，应以 http:// 或 https:// 开头' });
    expect(mockFetchCalls).toBe(0);
    expect(mockAuth.storedToken).toBeNull();
  });

  it('the advanced shape reports the SAME messages for the same failures (no copy drift between the two paths)', async () => {
    render(<ConnectHarness />);
    // Empty address half.
    await expect(
      act(async () =>
        hook!.connect({ backendUrl: '  ', endpoint: VALID_CONFIG.endpoint, token: 't' }),
      ),
    ).resolves.toEqual({ ok: false, message: '请先填写服务器地址' });
    // Invalid address.
    await expect(
      act(async () =>
        hook!.connect({
          backendUrl: 'ftp://x',
          endpoint: VALID_CONFIG.endpoint,
          token: 't',
        }),
      ),
    ).resolves.toEqual({ ok: false, message: '地址无效，应以 http:// 或 https:// 开头' });
    // Empty token on claimed server.
    await expect(
      act(async () =>
        hook!.connect({
          backendUrl: VALID_CONFIG.backendUrl,
          endpoint: VALID_CONFIG.endpoint,
          token: '  ',
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      message: '该服务器已绑定主人设备，请输入 owner token 或使用已配对设备扫码',
    });
    expect(mockFetchCalls).toBe(0); // ZERO credentials calls overall
  });

  // The server-supplied endpoint reaching storage through the hook is
  //  asserted at the screen level ("the server-supplied endpoint OVERRIDES
  //  the derived one") — which exercises this exact hook through the real
  //  Settings screen, so a duplicate render-only harness here would assert
  //  the same thing with more moving parts.
});
