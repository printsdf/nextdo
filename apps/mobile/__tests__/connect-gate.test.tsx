/**
 * ConnectGate + the root auth state machine (prod-deploy R3).
 *
 * Two layers:
 *  1. `ConnectGate` — presentational: tested directly (three outcomes,
 *     the initialError, the disabled states).
 *  2. The root layout — the startup pre-check state machine, rendered via
 *     `renderRouter` against a mocked `@nextdo/db` boundary whose auth
 *     surface is mutable per test (getOwnerToken / fetchCredentialsOnce /
 *     setOwnerToken / clearOwnerToken) and whose set/clear fire the
 *     SAME change notification as production, so a successful Gate
 *     connect flips the gate exactly as it does in the app.
 *
 * The screen mocks follow the tabs.smoke.test.tsx shell-mock shape (the
 * signed-in tests mount the Inbox tab for real).
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
  // Default: permissive (accept anything). Overwritten per state-machine test.
  validate: () => ({ ok: true, token: 'ps-jwt' }),
};

let mockTokenListener: (() => void) | null = null;

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
    // --- the auth-gate boundary (mutable per test) ---
    getOwnerToken: async () => mockAuth.storedToken,
    fetchCredentialsOnce: async (config: unknown, token: string): Promise<MockValidateResult> =>
      mockAuth.validate(config, token),
    setOwnerToken: async (token: string) => {
      mockAuth.storedToken = token;
      mockTokenListener?.();
    },
    clearOwnerToken: async () => {
      mockAuth.storedToken = null;
      mockTokenListener?.();
    },
    subscribeToOwnerTokenChange: (listener: () => void) => {
      mockTokenListener = listener;
      return () => {
        if (mockTokenListener === listener) {
          mockTokenListener = null;
        }
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
import { render } from '@testing-library/react-native';
import { ConnectGate, type ConnectGateResult } from '../components/connect-gate';

/* ------------------------------------------------------------------ *
 * ConnectGate — the presentational layer
 * ------------------------------------------------------------------ */

/** The Connect button's disabled state (Button sets accessibilityState). */
function connectButtonDisabled(label: string): boolean {
  const button = screen.getByRole('button', { name: label });
  return button.props.accessibilityState?.disabled === true;
}

describe('ConnectGate (presentational)', () => {
  it('shows the title, the token input and the connect button', () => {
    render(<ConnectGate onConnect={async () => ({ ok: true })} />);
    expect(screen.getByText('连接你的服务器')).toBeTruthy();
    expect(screen.getByPlaceholderText('owner token')).toBeTruthy();
    expect(screen.getByText('连接')).toBeTruthy();
  });

  it('submit sends the trimmed token; success shows no error', async () => {
    const onConnect = jest.fn(async (): Promise<ConnectGateResult> => ({ ok: true }));
    render(<ConnectGate onConnect={onConnect} />);

    fireEvent.changeText(screen.getByPlaceholderText('owner token'), '  tok-123  ');
    await act(async () => {});
    fireEvent.press(screen.getByText('连接'));
    await act(async () => {});

    expect(onConnect).toHaveBeenCalledWith('tok-123');
    expect(screen.queryByText('token 不正确')).toBeNull();
    expect(screen.queryByText(/连不上服务器/)).toBeNull();
  });

  it('401: inline 「token 不正确」, the gate stays, retry is possible', async () => {
    const onConnect = jest.fn(async () => ({ ok: false, message: 'token 不正确' }));
    render(<ConnectGate onConnect={onConnect} />);

    fireEvent.changeText(screen.getByPlaceholderText('owner token'), 'wrong-token');
    fireEvent.press(screen.getByText('连接'));
    await act(async () => {});

    expect(screen.getByText('token 不正确')).toBeTruthy();
    expect(screen.getByText('连接你的服务器')).toBeTruthy();
    expect(connectButtonDisabled('连接')).toBe(false);

    // Retry: the second press calls onConnect again.
    fireEvent.press(screen.getByText('连接'));
    await act(async () => {});
    expect(onConnect).toHaveBeenCalledTimes(2);
  });

  it('network: inline 「连不上服务器，请稍后重试」', async () => {
    render(
      <ConnectGate onConnect={async () => ({ ok: false, message: '连不上服务器，请稍后重试' })} />,
    );

    fireEvent.changeText(screen.getByPlaceholderText('owner token'), 'any-token');
    fireEvent.press(screen.getByText('连接'));
    await act(async () => {});

    expect(screen.getByText('连不上服务器，请稍后重试')).toBeTruthy();
  });

  it('initialError is shown before the first submit (the 401 pre-check copy)', () => {
    render(
      <ConnectGate onConnect={async () => ({ ok: true })} initialError="token 无效，请重新输入" />,
    );
    expect(screen.getByText('token 无效，请重新输入')).toBeTruthy();
  });

  it('the button is disabled on an empty token, enabled after typing', async () => {
    render(<ConnectGate onConnect={async () => ({ ok: true })} />);

    expect(connectButtonDisabled('连接')).toBe(true);
    fireEvent.changeText(screen.getByPlaceholderText('owner token'), 'tok-1');
    await act(async () => {});
    expect(connectButtonDisabled('连接')).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Root layout — the startup pre-check state machine
 * ------------------------------------------------------------------ */

describe('root auth state machine', () => {
  beforeEach(() => {
    mockAuth.storedToken = null;
    mockAuth.validate = () => ({ ok: true, token: 'ps-jwt' });
    mockTokenListener = null;
  });

  it('no stored token → ONLY the Gate (the app subtree does not mount)', async () => {
    mockAuth.storedToken = null;

    renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await act(async () => {});

    expect(screen.getByText('连接你的服务器')).toBeTruthy();
    // The Inbox screen (its 清空大脑 header) must not be in the tree.
    expect(screen.queryByText('清空大脑')).toBeNull();
  });

  it('stored token + 200 → the app (pre-check passes, provider mechanism unchanged)', async () => {
    mockAuth.storedToken = 'good-token';
    mockAuth.validate = (_c, t) =>
      t === 'good-token' ? { ok: true, token: 'ps-jwt' } : { ok: false, kind: 'rejected', status: 401 };

    renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await act(async () => {});

    expect(screen.getByText('清空大脑')).toBeTruthy();
    expect(screen.queryByText('连接你的服务器')).toBeNull();
  });

  it('stored token + 401 → clearOwnerToken + Gate with 「token 无效，请重新输入」', async () => {
    mockAuth.storedToken = 'stale-token';
    mockAuth.validate = () => ({ ok: false, kind: 'rejected', status: 401 });

    renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await act(async () => {});

    expect(mockAuth.storedToken).toBeNull(); // the stale token was forgotten
    expect(screen.getByText('连接你的服务器')).toBeTruthy();
    expect(screen.getByText('token 无效，请重新输入')).toBeTruthy();
    expect(screen.queryByText('清空大脑')).toBeNull();
  });

  it('stored token + network error → the app anyway (offline-first)', async () => {
    mockAuth.storedToken = 'good-token';
    mockAuth.validate = () => ({ ok: false, kind: 'network', detail: 'ECONNREFUSED' });

    renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await act(async () => {});

    expect(screen.getByText('清空大脑')).toBeTruthy();
    expect(screen.queryByText('连接你的服务器')).toBeNull();
  });

  it('Gate flow: valid token → setOwnerToken → the notification flips the gate', async () => {
    mockAuth.storedToken = null;
    mockAuth.validate = (_c, t) =>
      t === 'good-token' ? { ok: true, token: 'ps-jwt' } : { ok: false, kind: 'rejected', status: 401 };

    renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await act(async () => {});
    expect(screen.getByText('连接你的服务器')).toBeTruthy();

    fireEvent.changeText(screen.getByPlaceholderText('owner token'), 'good-token');
    await act(async () => {});
    fireEvent.press(screen.getByText('连接'));
    await act(async () => {});

    // The OWNER token was stored (not the minted service JWT)…
    expect(mockAuth.storedToken).toBe('good-token');
    // …and the same change notification that drives the provider's
    // connect() flipped the gate: the app is visible, the Gate is gone.
    expect(screen.getByText('清空大脑')).toBeTruthy();
    expect(screen.queryByText('连接你的服务器')).toBeNull();
  });

  it('Gate flow: wrong token → 「token 不正确」, still signed out, retryable', async () => {
    mockAuth.storedToken = null;
    mockAuth.validate = () => ({ ok: false, kind: 'rejected', status: 401 });

    renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await act(async () => {});

    fireEvent.changeText(screen.getByPlaceholderText('owner token'), 'bad-token');
    fireEvent.press(screen.getByText('连接'));
    await act(async () => {});

    expect(screen.getByText('token 不正确')).toBeTruthy();
    expect(mockAuth.storedToken).toBeNull();
    expect(screen.getByText('连接你的服务器')).toBeTruthy();
    expect(screen.queryByText('清空大脑')).toBeNull();
  });
});
