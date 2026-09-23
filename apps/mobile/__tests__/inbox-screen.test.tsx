/**
 * Inbox screen tests — the R1 capture → Clarify handoff
 * (design.md §6: 记一条问一条).
 *
 * Both capture paths (quick-capture modal + inline bar) must funnel through
 * the same handoff: save → the modal closes → the Clarify wizard opens for
 * the new item; and the one-shot `recapture=1` route param (from the
 * wizard's "再记一条") reopens the modal and clears itself.
 *
 * The PowerSync layer is mocked at the package boundary (same shell mocks
 * as tabs.smoke.test.tsx); `addInboxItem` returns the item so the mutation
 * hook resolves to it (PRD R1).
 */
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
    subscribeToOwnerTokenChange: () => () => undefined,
    createPowerSyncConnector: () => ({
      fetchCredentials: async () => null,
      uploadData: async () => undefined,
    }),
    subscribeAppStream: async () => undefined,
    wrapDb: () => ({}),
    isReactNativeRuntime: () => false,
    queryEnginePool: async () => ({ actions: [], calendar: [], projects: [] }),
    poolTriggerWatchQuery: compilable,
    inboxItemsWatchQuery: compilable,
    projectsWatchQuery: compilable,
    reviewRecordsWatchQuery: compilable,
    skipAction: async () => undefined,
    completeAction: async () => undefined,
    snoozeAction: async () => undefined,
    trashAction: async () => undefined,
    // R1: resolves to the created item (id drives the Clarify handoff).
    addInboxItem: jest.fn(async (_db: unknown, item: unknown) => item),
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
  // Stable identity across renders (see tabs.smoke.test.tsx).
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

import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { Modal } from 'react-native';
import { addInboxItem } from '@nextdo/db';

const mockedAddInboxItem = addInboxItem as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Inbox screen — R1 capture → Clarify handoff', () => {
  it('inline bar: save → the Clarify wizard opens for the new item', async () => {
    const view = renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await act(async () => {});

    // The launch modal is open by default — dismiss it to reach the bar.
    fireEvent.press(screen.getByText('稍后再说'));

    // The inline input (its full placeholder differs from the modal's).
    const input = screen.getByPlaceholderText('记下任何事…（回车保存）');
    fireEvent.changeText(input, '内联捕获');
    fireEvent(input, 'submitEditing');

    await waitFor(() => expect(view.getPathname().startsWith('/clarify/')).toBe(true));
    expect(mockedAddInboxItem).toHaveBeenCalledTimes(1);
    expect(mockedAddInboxItem.mock.calls[0][1]).toMatchObject({ title: '内联捕获' });
  });

  it('quick-capture modal: save → onCaptured hands off to the Clarify wizard', async () => {
    const view = renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await act(async () => {});

    // The launch modal is open — capture straight from it.
    const input = screen.getByPlaceholderText('记下任何事…（Enter 快速保存）');
    fireEvent.changeText(input, '弹窗捕获');
    fireEvent(input, 'submitEditing');

    await waitFor(() => expect(view.getPathname().startsWith('/clarify/')).toBe(true));
    expect(mockedAddInboxItem).toHaveBeenCalledTimes(1);
    expect(mockedAddInboxItem.mock.calls[0][1]).toMatchObject({ title: '弹窗捕获' });
    // The modal closed as part of the handoff.
    expect(view.root.findByType(Modal).props.visible).toBe(false);
  });

  it('recapture=1: reopens the modal and consumes the param (one-shot)', async () => {
    const view = renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await act(async () => {});

    // Close the launch modal first, so the param can be observed reopening it.
    fireEvent.press(screen.getByText('稍后再说'));
    expect(view.root.findByType(Modal).props.visible).toBe(false);

    // "再记一条" from the wizard navigates back with the one-shot param.
    act(() => {
      router.navigate({ pathname: '/(tabs)/inbox', params: { recapture: '1' } });
    });
    await act(async () => {});

    // The modal reopened…
    expect(view.root.findByType(Modal).props.visible).toBe(true);
    // …and the param was consumed (no re-trigger on later renders).
    expect(view.getSearchParams().recapture ?? undefined).toBeUndefined();
  });

  it('a failed save (null) stays on the inbox screen', async () => {
    mockedAddInboxItem.mockRejectedValueOnce(new Error('local write failed'));
    const view = renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await act(async () => {});

    fireEvent.press(screen.getByText('稍后再说'));
    const input = screen.getByPlaceholderText('记下任何事…（回车保存）');
    fireEvent.changeText(input, '会失败的捕获');
    fireEvent(input, 'submitEditing');

    await act(async () => {});
    expect(view.getPathname()).toBe('/inbox');
    // The draft is kept for a retry.
    expect(screen.getByPlaceholderText('记下任何事…（回车保存）').props.value).toBe('会失败的捕获');
  });
});
