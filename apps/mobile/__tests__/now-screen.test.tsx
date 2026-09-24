/**
 * Component tests — the Now tab (PRD D2 hero-first, design §5): the
 * engine-wired execution screen. The engine pool is mocked at the
 * packages/db boundary with real pool shapes; the REAL core `recommend()`
 * runs, so these tests pin the screen's rendering of each pool shape: a
 * recommendation, the empty pool, the all-filtered explainable empty
 * state, and the needsReclarify banner (consecutiveSkips ≥ 3).
 *
 * Rework assertions (design §5): the STATS ROW (可执行 n/总 · 预计耗时
 * Σ est · 认知负荷 三档), the CONTEXT FILTER chips (local UI state —
 * list area only, never the hero recommendation), and the always-expanded
 * eligible list (project chip + read-only context chips + due label).
 */
const poolRef: { current: unknown } = { current: null };
const ctxRef: { current: unknown[] } = { current: [] };
const projectsRef: { current: unknown[] } = { current: [] };

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
    seedDefaultContexts: async () => 0,
    isReactNativeRuntime: () => false,
    queryEnginePool: async () => poolRef.current,
    poolTriggerWatchQuery: compilable,
    skipAction: async () => undefined,
    completeAction: async () => undefined,
    snoozeAction: async () => undefined,
    trashAction: async () => undefined,
    listProjects: async () => projectsRef.current,
    listContexts: async () => ctxRef.current,
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

function context(id: string, name: string) {
  return { id, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', deletedAt: null, name };
}

/**
 * Preset the persisted engine context (the scene bar's store). The engine
 * contract excludes a context-TAGGED action when the engine context
 * doesn't contain one of its ids (spec: context-mismatch), so tests with
 * tagged actions must select the matching scenes here — independent of the
 * screen's list-filter chips under test.
 */
function presetEngineContext(contextIds: string[], availableMinutes = 60) {
  __setEngineContextStoreForTests({
    getItem: async () => JSON.stringify({ contextIds, availableMinutes }),
    setItem: async () => undefined,
  });
}

beforeEach(() => {
  setPool([]);
  ctxRef.current = [];
  projectsRef.current = [];
  // Fresh in-memory engine-context store per test (module-level backend).
  __setEngineContextStoreForTests(null);
});

describe('Now screen', () => {
  it('shows the recommendation card, reasons, the stats row and the always-open list', async () => {
    // The deadline-near, high-value action wins over the plain one.
    setPool([
      nextAction({
        id: 'winner',
        title: '交周报',
        value: 5,
        estMinutes: 30,
        contextIds: [],
        deadline: new Date(Date.now() + 60 * 60_000).toISOString(),
      }),
      nextAction({ id: 'loser', title: '整理桌面', value: 1, estMinutes: 25 }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    // The title renders twice — the hero AND the always-open list row.
    await waitFor(() => expect(screen.getAllByText('交周报')).toHaveLength(2));
    // The recommendation's subtitle + reasons render (Chinese labels).
    expect(screen.getByText('为什么是它？')).toBeTruthy();
    expect(screen.getByText(/截止时间快到了/)).toBeTruthy();
    // The three main buttons.
    expect(screen.getByText('开始')).toBeTruthy();
    expect(screen.getByText('换一个')).toBeTruthy();
    expect(screen.getByText('今天')).toBeTruthy();
    // Stats row: 2 eligible of 2 total · 30+25 = 55 分钟 · <60 → 轻.
    expect(screen.getByText('2/2 项')).toBeTruthy();
    expect(screen.getByText('55 分钟')).toBeTruthy();
    expect(screen.getByText('轻')).toBeTruthy();
    // The list is ALWAYS expanded: the second title is visible, and each
    // row carries its own 稍后 (hero button + 2 rows = 3).
    expect(screen.getByText('整理桌面')).toBeTruthy();
    expect(screen.getAllByText('稍后')).toHaveLength(3);
    // The context bar (scenes + time chips).
    expect(screen.getByText('当前场景')).toBeTruthy();
    expect(screen.getByText('任意')).toBeTruthy();
  });

  it('the stats row counts eligible vs filtered and bands the cognitive load', async () => {
    // 300 min > the default 60-minute slot → 'too-long' (filtered).
    setPool([
      nextAction({ id: 'a', title: '任务甲', estMinutes: 40 }),
      nextAction({ id: 'b', title: '任务乙', estMinutes: 40 }),
      nextAction({ id: 'long', title: '超长任务', estMinutes: 300 }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() => expect(screen.getByText('2/3 项')).toBeTruthy());
    // 40+40 = 80 分钟 → 平 (60–180 inclusive).
    expect(screen.getByText('80 分钟')).toBeTruthy();
    expect(screen.getByText('平')).toBeTruthy();
    // The filtered action is not in the list.
    expect(screen.queryByText('超长任务')).toBeNull();
  });

  it('heavy eligible pools are labeled 重', async () => {
    // Four 50-minute actions fit the default 60-minute slot; 200 > 180.
    setPool([
      nextAction({ id: 'a', title: '甲任务', estMinutes: 50 }),
      nextAction({ id: 'b', title: '乙任务', estMinutes: 50 }),
      nextAction({ id: 'c', title: '丙任务', estMinutes: 50 }),
      nextAction({ id: 'd', title: '丁任务', estMinutes: 50 }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() => expect(screen.getByText('4/4 项')).toBeTruthy());
    // 200 分钟 → >180 → 重.
    expect(screen.getByText('200 分钟')).toBeTruthy();
    expect(screen.getByText('重')).toBeTruthy();
  });

  it('context chips filter the list only — the hero recommendation stays put', async () => {
    // Engine context selects BOTH scenes → every tagged action is eligible
    // (the engine's context-mismatch rule); the list filter starts empty.
    presetEngineContext(['c-1', 'c-2']);
    ctxRef.current = [context('c-1', '电脑'), context('c-2', '手机')];
    setPool([
      nextAction({ id: 'desk', title: '电脑上的事', value: 5, contextIds: ['c-1'] }),
      nextAction({ id: 'phone', title: '手机上的事', value: 1, contextIds: ['c-2'] }),
      nextAction({ id: 'any', title: '随地可做', value: 1, contextIds: [] }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() => expect(screen.getByText('全部')).toBeTruthy());
    // Filter chips are name-only (counts removed 2026-09-24) and repeat the
    // engine bar's context names; each visible list row adds its read-only
    // context chip. DOM order: bar chip, filter chip, row chip.
    expect(screen.getAllByText('电脑')).toHaveLength(3);
    expect(screen.getAllByText('手机')).toHaveLength(3);

    // Select 手机 (filter chip) → the 电脑-only action leaves the LIST,
    // while the phone and the context-less actions stay (context-less
    // actions survive every filter)…
    fireEvent.press(screen.getAllByText('手机')[1]!);
    await waitFor(() => expect(screen.getByText('手机上的事')).toBeTruthy());
    expect(screen.getByText('随地可做')).toBeTruthy();
    // …and the HERO still shows the 电脑 action (exactly one occurrence —
    // the hero, not the list).
    expect(screen.getAllByText('电脑上的事')).toHaveLength(1);

    // 全部 resets the filter → all three rows back (the 电脑 action is in
    // the hero AND its row again).
    fireEvent.press(screen.getByText('全部'));
    await waitFor(() => expect(screen.getAllByText('电脑上的事')).toHaveLength(2));
    expect(screen.getByText('手机上的事')).toBeTruthy();
    expect(screen.getByText('随地可做')).toBeTruthy();
  });

  it('a context that matches nothing shows the filtered empty state (hero untouched)', async () => {
    presetEngineContext(['c-1', 'c-2', 'c-9']);
    ctxRef.current = [context('c-1', '电脑'), context('c-9', '沟通')];
    setPool([
      nextAction({ id: 'desk', title: '电脑上的事', value: 5, contextIds: ['c-1'] }),
      // c-2 has no context entity: no filter chip for it, and its action
      // matches no name-based filter selection.
      nextAction({ id: 'orphan', title: '手机上的事', contextIds: ['c-2'] }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() => expect(screen.getByText('全部')).toBeTruthy());
    // Filter chips are name-only: 沟通 appears twice (bar + filter — no
    // 沟通-tagged row), 电脑 thrice (bar + filter + the desk row's chip).
    expect(screen.getAllByText('沟通')).toHaveLength(2);
    expect(screen.getAllByText('电脑')).toHaveLength(3);

    fireEvent.press(screen.getAllByText('沟通')[1]!);
    await waitFor(() => expect(screen.getByText('没有匹配当前情境的可执行事项')).toBeTruthy());
    // The hero (电脑上的事) is untouched.
    expect(screen.getByText('电脑上的事')).toBeTruthy();
  });

  it('list rows show the project chip, read-only context chips and the due label', async () => {
    presetEngineContext(['c-1']);
    ctxRef.current = [context('c-1', '电脑')];
    projectsRef.current = [{ id: 'p-9', title: '周报项目' }];
    setPool([
      nextAction({
        id: 'due',
        title: '快截止的事',
        value: 5,
        contextIds: ['c-1'],
        projectId: 'p-9',
        deadline: new Date(Date.now() + 24 * 3600_000).toISOString(),
      }),
      nextAction({ id: 'free', title: '不着急的事', contextIds: [] }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    // The title renders twice — the hero AND its list row.
    await waitFor(() => expect(screen.getAllByText('快截止的事')).toHaveLength(2));
    // Project chip (the hero subtitle is a joined string, not this exact text).
    expect(screen.getByText('周报项目')).toBeTruthy();
    // Read-only context chip — in the engine bar, the filter chips AND the row.
    expect(screen.getAllByText('电脑')).toHaveLength(3);
    // Due labels: tomorrow's deadline → 明天; the deadline-less row → 随时.
    expect(screen.getByText('明天')).toBeTruthy();
    expect(screen.getByText('随时')).toBeTruthy();
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

    await waitFor(() => expect(screen.getAllByText('写季度总结')).toHaveLength(2));
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

    await waitFor(() => expect(screen.getAllByText('晨间拉伸')).toHaveLength(2));
    expect(screen.queryByText(/连续跳过/)).toBeNull();
    expect(screen.queryByText('重新明晰')).toBeNull();
  });

  it('changing the available-time chip recomputes the recommendation (AC3)', async () => {
    setPool([
      nextAction({ id: 'long', title: '长任务', value: 5, estMinutes: 25 }),
      nextAction({ id: 'short', title: '短任务', value: 1, estMinutes: 10 }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    // Default 60-minute slot: both stay eligible (the list is always open
    // — each title renders in the hero and its row).
    await waitFor(() => expect(screen.getAllByText('长任务')).toHaveLength(2));
    expect(screen.getByText('短任务')).toBeTruthy();
    expect(screen.getByText('2/2 项')).toBeTruthy();

    // A 15-minute slot must drop the 25-min action (too-long) — from the
    // hero AND the list; the pool recomputes from the same settings.
    fireEvent.press(screen.getByRole('button', { name: '15' }));
    await waitFor(() => {
      expect(screen.getAllByText('短任务')).toHaveLength(2);
      expect(screen.queryByText('长任务')).toBeNull();
    });
    expect(screen.getByText('1/2 项')).toBeTruthy();
  });

  it('"换一个" rotates through the eligible list and wraps (AC3)', async () => {
    setPool([
      nextAction({ id: 'top', title: '头任务', value: 5, estMinutes: 25 }),
      nextAction({ id: 'second', title: '次任务', value: 1, estMinutes: 10 }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    // The top-scored action is the hero (its est tag is unique — the list
    // rows show no est, the stats row shows the Σ).
    await waitFor(() => expect(screen.getByText('25 分钟')).toBeTruthy());

    // "换一个" persists the skip (mocked no-op) and the hero rotates.
    fireEvent.press(screen.getByRole('button', { name: '换一个' }));
    await waitFor(() => expect(screen.getByText('10 分钟')).toBeTruthy());
    expect(screen.queryByText('25 分钟')).toBeNull();

    // Skipping again wraps back to the top (carousel semantics).
    fireEvent.press(screen.getByRole('button', { name: '换一个' }));
    await waitFor(() => expect(screen.getByText('25 分钟')).toBeTruthy());
  });
});
