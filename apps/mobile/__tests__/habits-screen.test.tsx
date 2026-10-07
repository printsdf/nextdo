/**
 * Component tests — the habits screen (task 10-02 — 习惯创建表单与
 * 21 天挑战启动).
 *
 * The screen runs for real against a mocked `@nextdo/db` boundary:
 *  - `startHabit` / `trashHabit` are jest.fn spies, so the assertions
 *    pin the ARGUMENTS the screen hands the db layer (the fixed
 *    `cycleDays: 21` / `status: 'active'`, the actionTitle inheritance,
 *    the optional window) rather than a re-implementation of the
 *    transaction;
 *  - `habitCycleDay` is the REAL implementation (requireActual), so the
 *    「第 N/21 天」 readout is not asserted against a second copy of the
 *    cycle rule (design.md §2).
 *
 * Mounted the way the app reaches it — `/(tabs)/settings` first, then
 * `testRouter.navigate('/habits')` — so `back()` has a parent to land
 * on (testing-guidelines: an unhandled GO_BACK wedges the fake-timer
 * waitFor loop).
 */

/** The mutable local "database" the mocked reads return. */
const mockHabitsRef: { current: unknown[] } = { current: [] };
const mockDaysRef: { current: unknown[] } = { current: [] };

/** The habit row handed to `startHabit` by the last submit. */
const mockStartArgsRef: { current: unknown } = { current: null };

jest.mock('@nextdo/db', () => {
  const compilable = () => ({
    compile: () => ({ sql: 'SELECT 1', parameters: [] }),
    execute: async () => [],
  });
  // The REAL cycle-day rule — re-implementing it in the mock would make
  // these tests assert a second copy of the rule instead of the exported
  // one the screen actually calls.
  const actual = jest.requireActual('@nextdo/db') as {
    habitCycleDay: (startedAt: string, cycleDays: number, localDate: string) => number | null;
  };
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    disconnect: async () => undefined,
    close: async () => undefined,
  };
  return {
    ...actual,
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
    // The delivery hook's source query (the root layout mounts
    // useReminderDelivery in every renderRouter test).
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
    skipAction: async () => undefined,
    completeAction: async () => undefined,
    snoozeAction: async () => undefined,
    trashAction: async () => undefined,
    listProjects: async () => [],
    listContexts: async () => [],
    addContext: async () => undefined,
    // --- the habits surface under test ---
    listHabits: async () => mockHabitsRef.current,
    listHabitDays: async () => mockDaysRef.current,
    startHabit: async (db: unknown, habit: { id: string }, now: unknown) => {
      mockStartArgsRef.current = { db, habit, now };
      mockHabitsRef.current = [...mockHabitsRef.current, habit];
      return { habit, today: { id: 'hd-seeded', habitId: habit.id, localDate: '20260101' } };
    },
    trashHabit: async (_db: unknown, args: { id: string }) => {
      mockHabitsRef.current = mockHabitsRef.current.filter(
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
    close: async () => undefined,
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
import { habitDayId, localDateKey, toIso } from '@nextdo/core';

/** A live Habit row as `listHabits` returns it (started today → day 1). */
function habit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const startedAt = toIso(new Date());
  return {
    id: 'h-1',
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: null,
    title: '阅读',
    actionTitle: '阅读 30 min',
    estMinutes: 30,
    value: 4,
    windowStart: '19:00',
    windowEnd: '23:00',
    cycleDays: 21,
    startedAt,
    status: 'active',
    ...overrides,
  };
}

/** Today's done HabitDay for `habitId` (counts toward 本期已完成). */
function doneToday(habitId: string) {
  const localDate = localDateKey(new Date());
  return {
    id: habitDayId(habitId, localDate),
    createdAt: toIso(new Date()),
    updatedAt: toIso(new Date()),
    deletedAt: null,
    habitId,
    localDate,
    status: 'done',
    consecutiveSkips: 0,
  };
}

/** Mount the screen the way the app reaches it (parent route first). */
async function openHabits(): Promise<void> {
  renderRouter('app', { initialUrl: '/(tabs)/settings' });
  await flush();
  testRouter.navigate('/habits');
  await flush();
}

/** Flush several microtask rounds (the read/insert chains are promise-hop
 *  deep and the router navigation settles across several of them). */
async function flush(rounds = 10): Promise<void> {
  let p: Promise<unknown> = Promise.resolve();
  for (let i = 0; i < rounds; i++) {
    p = p.then(() => act(async () => {}));
  }
  await p;
}

/** The submit button's disabled state (Button mirrors it into a11y state). */
function submitDisabled(): boolean {
  return screen.getByRole('button', { name: '开始 21 天挑战' }).props.accessibilityState?.disabled === true;
}

async function fillRequiredFields(): Promise<void> {
  fireEvent.changeText(screen.getByLabelText('习惯名'), '阅读');
  fireEvent.changeText(screen.getByLabelText('预计分钟'), '30');
  await flush();
}

/** Turn the window switch on and type the two halves. */
async function fillWindow(start: string, end: string): Promise<void> {
  fireEvent.press(screen.getByRole('button', { name: '开启时间窗口' }));
  await flush();
  fireEvent.changeText(screen.getByLabelText('时间窗口开始'), start);
  fireEvent.changeText(screen.getByLabelText('时间窗口结束'), end);
  await flush();
}

beforeEach(() => {
  mockHabitsRef.current = [];
  mockDaysRef.current = [];
  mockStartArgsRef.current = null;
  mockExpoNotifications.getPermissionsAsync.mockResolvedValue({
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
    expires: 'never',
  });
});

describe('habits screen', () => {
  it('starts a 21-day challenge: cycleDays 21, status active, and the action title inherits the habit name', async () => {
    await openHabits();

    await fillRequiredFields();
    fireEvent.press(screen.getByRole('button', { name: '价值 4' }));
    await fillWindow('19:00', '23:00');
    await flush();

    expect(submitDisabled()).toBe(false);
    fireEvent.press(screen.getByRole('button', { name: '开始 21 天挑战' }));
    await flush();

    const args = mockStartArgsRef.current as { habit: Record<string, unknown> } | null;
    expect(args).not.toBeNull();
    const created = args!.habit;
    expect(created['title']).toBe('阅读');
    // An empty 每日行动 inherits the habit name (the generated day's title).
    expect(created['actionTitle']).toBe('阅读');
    expect(created['estMinutes']).toBe(30);
    expect(created['value']).toBe(4);
    expect(created['cycleDays']).toBe(21);
    expect(created['status']).toBe('active');
    expect(created['windowStart']).toBe('19:00');
    expect(created['windowEnd']).toBe('23:00');
    // The weekday mask is out of scope — never written.
    expect(created['windowDays']).toBeUndefined();
  });

  it('keeps the value default at 3 and an explicit 每日行动 when the user types one', async () => {
    await openHabits();

    await fillRequiredFields();
    fireEvent.changeText(screen.getByLabelText('每日行动标题（选填）'), '读 30 分钟');
    await flush();
    fireEvent.press(screen.getByRole('button', { name: '开始 21 天挑战' }));
    await flush();

    const args = mockStartArgsRef.current as { habit: Record<string, unknown> } | null;
    expect(args!.habit['actionTitle']).toBe('读 30 分钟');
    expect(args!.habit['value']).toBe(3);
  });

  it('writes NO window when the switch is off (an all-day habit)', async () => {
    await openHabits();

    await fillRequiredFields();
    fireEvent.press(screen.getByRole('button', { name: '开始 21 天挑战' }));
    await flush();

    const args = mockStartArgsRef.current as { habit: Record<string, unknown> } | null;
    expect(args!.habit['windowStart']).toBeUndefined();
    expect(args!.habit['windowEnd']).toBeUndefined();
  });

  it('a half-filled window keeps the submit disabled', async () => {
    await openHabits();

    await fillRequiredFields();
    // Only the start half typed — a window must have BOTH ends.
    fireEvent.press(screen.getByRole('button', { name: '开启时间窗口' }));
    await flush();
    fireEvent.changeText(screen.getByLabelText('时间窗口开始'), '19:00');
    await flush();
    expect(submitDisabled()).toBe(true);
    expect(mockStartArgsRef.current).toBeNull();

    // Completing the pair enables it.
    fireEvent.changeText(screen.getByLabelText('时间窗口结束'), '23:00');
    await flush();
    expect(submitDisabled()).toBe(false);
  });

  it('start >= end (and a malformed time) keeps the submit disabled', async () => {
    await openHabits();

    await fillRequiredFields();
    await fillWindow('23:00', '19:00');
    expect(submitDisabled()).toBe(true);
    expect(mockStartArgsRef.current).toBeNull();

    // start === end is equally invalid (the window is half-open).
    fireEvent.changeText(screen.getByLabelText('时间窗口开始'), '20:00');
    fireEvent.changeText(screen.getByLabelText('时间窗口结束'), '20:00');
    await flush();
    expect(submitDisabled()).toBe(true);

    // A malformed HH:mm is refused too.
    fireEvent.changeText(screen.getByLabelText('时间窗口开始'), '25:00');
    fireEvent.changeText(screen.getByLabelText('时间窗口结束'), '23:00');
    await flush();
    expect(submitDisabled()).toBe(true);
  });

  it('a non-positive or fractional 预计分钟 keeps the submit disabled', async () => {
    await openHabits();

    fireEvent.changeText(screen.getByLabelText('习惯名'), '阅读');
    fireEvent.changeText(screen.getByLabelText('预计分钟'), '0');
    await flush();
    expect(submitDisabled()).toBe(true);

    fireEvent.changeText(screen.getByLabelText('预计分钟'), '1.5');
    await flush();
    expect(submitDisabled()).toBe(true);

    fireEvent.changeText(screen.getByLabelText('预计分钟'), '30');
    await flush();
    expect(submitDisabled()).toBe(false);
  });

  it('shows the challenge day, the window and the done count; deleting removes the row', async () => {
    mockHabitsRef.current = [habit()];
    mockDaysRef.current = [doneToday('h-1')];
    await openHabits();

    // 第 1/21 天 — the habit started today, so the cycle day is 1.
    await waitFor(() => expect(screen.getByText('第 1/21 天')).toBeTruthy());
    expect(screen.getByText('每日行动：阅读 30 min')).toBeTruthy();
    expect(screen.getByText('19:00–23:00')).toBeTruthy();
    expect(screen.getByText('30 分钟')).toBeTruthy();
    expect(screen.getByText('价值 4')).toBeTruthy();
    expect(screen.getByText('本期已完成 1 天')).toBeTruthy();

    // 删除 → the row disappears (soft delete + reload).
    fireEvent.press(screen.getAllByRole('button', { name: '删除' })[0]!);
    await flush();
    await waitFor(() => expect(screen.queryByText('阅读')).toBeNull());
    expect(mockHabitsRef.current).toHaveLength(0);
  });

  it('an all-day habit (no window) reads 全天 instead of a time range', async () => {
    mockHabitsRef.current = [
      habit({
        id: 'h-2',
        title: '喝水',
        actionTitle: '喝水',
        windowStart: undefined,
        windowEnd: undefined,
      }),
    ];
    await openHabits();

    await waitFor(() => expect(screen.getByText('喝水')).toBeTruthy());
    expect(screen.getByText('全天')).toBeTruthy();
    // No HH:mm pair is rendered for this row (the window tag is 全天).
    expect(screen.queryByText(/^\d{2}:\d{2}–\d{2}:\d{2}$/)).toBeNull();
  });

  it('the Settings card entry reaches the screen and the zero-habit empty state renders', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    // The Settings card (the entry point) is visible from the parent route.
    expect(screen.getByRole('button', { name: '管理习惯' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: '管理习惯' }));
    await flush();

    await waitFor(() => expect(screen.getByText('还没有习惯')).toBeTruthy());
    // The cycle copy states the challenge semantics AND explicitly denies
    // the promise (the domain model forbids 「21 天保证养成习惯」).
    expect(screen.getByText(/21 天是一个挑战周期/)).toBeTruthy();
    expect(screen.getByText(/不是「一定能养成」的保证/)).toBeTruthy();
    // The form is visible even with no habits (one tap to create the first).
    expect(screen.getByLabelText('习惯名')).toBeTruthy();
  });
});