/**
 * Component tests — the Now tab (PRD R4, design.md §4.1): the engine-wired
 * execution screen. The engine pool is mocked at the packages/db boundary
 * with real pool shapes; the REAL core `recommend()` runs, so these tests
 * pin the screen's rendering of each pool shape: a recommendation, the
 * empty pool, the all-filtered explainable empty state, and the
 * needsReclarify banner (consecutiveSkips ≥ 3).
 */
const poolRef: { current: unknown } = { current: null };

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
    queryEnginePool: async () => poolRef.current,
    poolTriggerWatchQuery: compilable,
    skipAction: async () => undefined,
    completeAction: async () => undefined,
    snoozeAction: async () => undefined,
    trashAction: async () => undefined,
    listProjects: async () => [],
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

import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { NextCandidate } from '@nextdo/core';
import { __setEngineContextStoreForTests } from '@/lib/engine-context';

/** A minimal eligible next-action candidate (the pool contract shape). */
function nextAction(overrides: Partial<NextCandidate> = {}): NextCandidate {
  return {
    id: `n-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'next',
    title: '写季度总结',
    contextIds: [],
    estMinutes: 25,
    value: 3,
    consecutiveSkips: 0,
    dependencyDone: true,
    createdAt: '2026-09-20T01:00:00.000Z',
    ...overrides,
  };
}

function setPool(actions: NextCandidate[]) {
  poolRef.current = { actions, calendar: [], projects: [] };
}

beforeEach(() => {
  setPool([]);
  // Fresh in-memory engine-context store per test (module-level backend).
  __setEngineContextStoreForTests(null);
});

describe('Now screen', () => {
  it('shows the recommendation card, reasons, and the eligible count', async () => {
    // The deadline-near, high-value action wins over the plain one.
    setPool([
      nextAction({
        id: 'winner',
        title: '交周报',
        value: 5,
        estMinutes: 30,
        deadline: new Date(Date.now() + 60 * 60_000).toISOString(),
      }),
      nextAction({ id: 'loser', title: '整理桌面', value: 1 }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() => expect(screen.getByText('交周报')).toBeTruthy());
    // The recommendation's subtitle + reasons render (Chinese labels).
    expect(screen.getByText('为什么是它？')).toBeTruthy();
    expect(screen.getByText(/截止时间快到了/)).toBeTruthy();
    // The three main buttons.
    expect(screen.getByText('开始')).toBeTruthy();
    expect(screen.getByText('换一个')).toBeTruthy();
    expect(screen.getByText('稍后')).toBeTruthy();
    // Both actions are eligible → the expandable row.
    expect(screen.getByText('稍后 2 个可执行事项')).toBeTruthy();
    // The context bar (scenes + time chips).
    expect(screen.getByText('当前场景')).toBeTruthy();
    expect(screen.getByText('任意')).toBeTruthy();
  });

  it('the empty pool shows the capture hint', async () => {
    setPool([]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });
    await waitFor(() => expect(screen.getByText('执行池是空的')).toBeTruthy());
    expect(screen.getByText(/去收件箱捕获一条/)).toBeTruthy();
  });

  it('an all-filtered pool explains why (rule labels, Chinese)', async () => {
    // 300 min > the default 60-minute slot → 'too-long'.
    setPool([nextAction({ id: 'long', estMinutes: 300 })]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() =>
      expect(screen.getByText('没有任何适合当前场景与时间的行动')).toBeTruthy(),
    );
    expect(screen.getByText('被过滤的事项：')).toBeTruthy();
    expect(screen.getByText('• 写季度总结 — 预估时长超过可用时间')).toBeTruthy();
  });

  it('the re-clarify banner appears at 3 consecutive skips with the count', async () => {
    setPool([nextAction({ id: 'skippy', consecutiveSkips: 3 })]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() =>
      expect(screen.getByText('这个任务已连续跳过 3 次 — 重新明确下一步？')).toBeTruthy(),
    );
    expect(screen.getByText('重新明晰')).toBeTruthy();
  });

  it('no banner below the threshold (2 skips)', async () => {
    setPool([nextAction({ id: 'once', consecutiveSkips: 2 })]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() => expect(screen.getByText('写季度总结')).toBeTruthy());
    expect(screen.queryByText(/连续跳过/)).toBeNull();
  });

  it('no re-clarify banner for habit days (habits are not re-clarifiable — db contract)', async () => {
    poolRef.current = {
      actions: [
        {
          id: 'hd-1',
          kind: 'habit',
          title: '晨间拉伸',
          habitId: 'h-1',
          cycleDay: 3,
          cycleDays: 21,
          contextIds: [],
          estMinutes: 10,
          value: 2,
          consecutiveSkips: 3,
          dependencyDone: true,
          createdAt: '2026-09-20T01:00:00.000Z',
        },
      ],
      calendar: [],
      projects: [],
    };
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() => expect(screen.getByText('晨间拉伸')).toBeTruthy());
    expect(screen.queryByText(/连续跳过/)).toBeNull();
    expect(screen.queryByText('重新明晰')).toBeNull();
  });

  it('changing the available-time chip recomputes the recommendation (AC3)', async () => {
    setPool([
      nextAction({ id: 'long', title: '长任务', value: 5, estMinutes: 25 }),
      nextAction({ id: 'short', title: '短任务', value: 1, estMinutes: 10 }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    // Default 60-minute slot: the higher-value 25-min action is recommended;
    // both stay eligible (the list is collapsed, so the second title is hidden).
    await waitFor(() => expect(screen.getByText('长任务')).toBeTruthy());
    expect(screen.getByText('稍后 2 个可执行事项')).toBeTruthy();

    // A 15-minute slot must drop the 25-min action (too-long) and promote
    // the 10-min one — the pool recomputes from the same settings instance.
    fireEvent.press(screen.getByRole('button', { name: '15' }));
    await waitFor(() => {
      expect(screen.getByText('短任务')).toBeTruthy();
      expect(screen.queryByText('长任务')).toBeNull();
    });
  });

  it('"换一个" rotates through the eligible list and wraps (AC3)', async () => {
    setPool([
      nextAction({ id: 'top', title: '头任务', value: 5, estMinutes: 25 }),
      nextAction({ id: 'second', title: '次任务', value: 1, estMinutes: 10 }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    // The top-scored action is displayed first.
    await waitFor(() => expect(screen.getByText('头任务')).toBeTruthy());

    // "换一个" persists the skip (mocked no-op) and shows the next eligible.
    fireEvent.press(screen.getByRole('button', { name: '换一个' }));
    await waitFor(() => expect(screen.getByText('次任务')).toBeTruthy());

    // Skipping again wraps back to the top (carousel semantics).
    fireEvent.press(screen.getByRole('button', { name: '换一个' }));
    await waitFor(() => expect(screen.getByText('头任务')).toBeTruthy());
  });
});
