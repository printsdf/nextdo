/**
 * Component tests — the contexts screen (task 10-08 — 场景删除入口).
 *
 * Runs for real against a mocked `@nextdo/db` boundary: `listContexts` /
 * `addContext` / `trashContext` are the mock surface, so the assertions pin
 * the ARGUMENTS the screen hands the db layer (the id passed to trash, the
 * name passed to create) rather than re-implementing the soft delete.
 *
 * `trashContext` in the mock APPLIES to the fixture list (the row disappears
 * on re-read), which is what lets the "the row is gone after 删除" assertion
 * be real: without the mutation the list would re-render unchanged.
 *
 * Mounted the way the app reaches it — `/(tabs)/now` first, then
 * `testRouter.navigate('/contexts')` — so `back()` has a parent to land on
 * (testing-guidelines: an unhandled GO_BACK wedges the fake-timer waitFor).
 */

/** The mutable local "database" the mocked `listContexts` returns. */
const mockContextsRef: { current: unknown[] } = { current: [] };

/** How many times `listContexts` actually ran (the read counter). */
const contextReads = { count: 0 };

/** Set to a message to make the NEXT `trashContext` call reject once. */
const trashFailure: { message: string | null } = { message: null };

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
    getOwnerToken: async () => null,
    getStoredBackendConfig: async () => null,
    fetchCredentialsOnce: async () => ({ ok: true, token: 'ps-jwt' }),
    setOwnerToken: async () => undefined,
    clearOwnerToken: async () => undefined,
    subscribeToOwnerTokenChange: () => () => undefined,
    createPowerSyncConnector: () => ({
      fetchCredentials: async () => null,
      uploadData: async () => undefined,
    }),
    subscribeAppStream: async () => undefined,
    wrapDb: () => ({}),
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
    listProjects: async () => [],
    listHabits: async () => [],
    listHabitDays: async () => [],
    // --- the contexts surface under test ---
    listContexts: async () => {
      contextReads.count += 1;
      return mockContextsRef.current;
    },
    addContext: async (_db: unknown, context: unknown) => {
      mockContextsRef.current = [...mockContextsRef.current, context];
      return context;
    },
    trashContext: async (_db: unknown, args: { id: string }) => {
      if (trashFailure.message !== null) {
        const message = trashFailure.message;
        trashFailure.message = null;
        throw new Error(message);
      }
      mockContextsRef.current = mockContextsRef.current.filter(
        (row) => (row as { id: string }).id !== args.id,
      );
    },
  };
});

jest.mock('@powersync/react', () => {
  const React = jest.requireActual('react');
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    close: () => Promise.resolve(undefined),
    // The delivery hook subscribes to local changes — a no-op here.
    onChange: () => () => undefined,
  };
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

jest.mock('expo-notifications', () => mockExpoNotifications);

import { act, fireEvent, renderRouter, screen, testRouter, waitFor } from 'expo-router/testing-library';
import { mockExpoNotifications } from './mocks/expo-notifications';
import { toIso } from '@nextdo/core';

/** A live Context row as `listContexts` returns it. */
function context(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = toIso(new Date());
  return {
    id: 'c-1',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    name: '客厅',
    ...overrides,
  };
}

/** Flush several microtask rounds (the read/write chains are promise-hop
 *  deep and the router navigation settles across several of them). */
async function flush(rounds = 10): Promise<void> {
  let p: Promise<unknown> = Promise.resolve();
  for (let i = 0; i < rounds; i++) {
    p = p.then(() => act(async () => {}));
  }
  await p;
}

/** Mount the screen the way the app reaches it (parent route first). */
async function openContexts(): Promise<void> {
  renderRouter('app', { initialUrl: '/(tabs)/now' });
  await flush();
  testRouter.navigate('/contexts');
  await flush();
}

beforeEach(() => {
  mockContextsRef.current = [context(), context({ id: 'c-2', name: '书房' })];
  contextReads.count = 0;
  trashFailure.message = null;
  mockExpoNotifications.getPermissionsAsync.mockResolvedValue({
    status: 'undetermined',
    granted: false,
  } as never);
});

describe('Contexts screen', () => {
  it('lists every live scene by name', async () => {
    await openContexts();

    await waitFor(() => expect(screen.getByText('场景')).toBeTruthy());
    expect(screen.getByText('客厅')).toBeTruthy();
    expect(screen.getByText('书房')).toBeTruthy();
  });

  it('pressing 删除 removes that scene and re-reads the list', async () => {
    await openContexts();
    await waitFor(() => expect(screen.getByText('客厅')).toBeTruthy());

    const rows = screen.getAllByRole('button', { name: '删除' });
    expect(rows).toHaveLength(2);
    fireEvent.press(rows[0]!);
    await flush();

    // The mock's trashContext drops the row, so the re-read MUST show it gone.
    expect(screen.queryByText('客厅')).toBeNull();
    expect(screen.getByText('书房')).toBeTruthy();
  });

  it('a failed 删除 keeps the row and surfaces the error (no wasted re-read)', async () => {
    trashFailure.message = 'context trash failed';
    await openContexts();
    await waitFor(() => expect(screen.getByText('客厅')).toBeTruthy());

    // Baseline AFTER mount — the mount read must not count as a reload.
    const base = contextReads.count;
    fireEvent.press(screen.getAllByRole('button', { name: '删除' })[0]!);

    // Wait for the error text: that proves the hook's catch has run, so a
    // still-equal counter means "did not re-read", not "not yet re-read".
    await waitFor(() => expect(screen.getByText('context trash failed')).toBeTruthy());
    expect(contextReads.count).toBe(base);
    // The row survives a rejected write.
    expect(screen.getByText('客厅')).toBeTruthy();
  });

  it('an empty 场景名 cannot submit', async () => {
    await openContexts();
    await waitFor(() => expect(screen.getByText('客厅')).toBeTruthy());

    const submit = screen.getByRole('button', { name: '添加场景' });
    expect(submit.props.accessibilityState?.disabled).toBe(true);

    fireEvent.changeText(screen.getByLabelText('新场景名称'), '   ');
    await flush();
    expect(screen.getByRole('button', { name: '添加场景' }).props.accessibilityState?.disabled).toBe(true);
  });

  it('the create form appends a scene and clears the input', async () => {
    await openContexts();
    await waitFor(() => expect(screen.getByText('客厅')).toBeTruthy());

    fireEvent.changeText(screen.getByLabelText('新场景名称'), '阳台');
    await flush();
    fireEvent.press(screen.getByRole('button', { name: '添加场景' }));
    await flush();

    expect(screen.getByText('阳台')).toBeTruthy();
    expect(screen.getByLabelText('新场景名称').props.value).toBe('');
  });

  it('shows the empty state when no scene exists', async () => {
    mockContextsRef.current = [];
    await openContexts();

    await waitFor(() => expect(screen.getByText('还没有场景')).toBeTruthy());
    expect(screen.getByText('还没有场景 —— 不选即随处可执行。也可以现在建一个。')).toBeTruthy();
  });
});
