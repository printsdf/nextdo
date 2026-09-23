/**
 * Component tests — the daily review route (PRD R7, design.md §4.5):
 * snapshot rendering (inbox / completed / uncovered projects / waiting /
 * schedule / repeated skips), answer collection (single choice per row),
 * the fixed SUBMIT ORDER (decision transactions first, the append-only
 * record LAST), failure-stop (a failed transaction → NO record), and the
 * reschedule date validation.
 *
 * The data + mutation hooks run for real against a mocked `@nextdo/db`
 * boundary — the screen logic and the submit sequence are under test.
 */
const NOW = '2026-09-23T10:00:00.000Z';

const dataRef = {
  snapshot: {
    inboxCount: 2,
    completedToday: ['c-1'],
    stillOpen: ['a-1', 'a-2', 'a-3', 'a-4'],
    projectsMissingActions: ['p-1'],
    waitingFollowUps: ['w-1'],
    calendarToday: ['cal-1'],
    calendarTomorrow: ['cal-2'],
    repeatedSkips: ['a-5', 'hd-1', 'cal-3'],
  },
  actions: [
    {
      id: 'a-1', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '写周报',
      projectId: null, contextIds: [], estMinutes: 30, value: 3, deadline: null,
      consecutiveSkips: 0, status: 'open',
    },
    {
      id: 'a-2', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '整理实验数据',
      projectId: null, contextIds: [], estMinutes: 60, value: 3, deadline: null,
      consecutiveSkips: 0, status: 'open',
    },
    {
      id: 'a-3', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '回复邮件',
      projectId: null, contextIds: [], estMinutes: 10, value: 3, deadline: null,
      consecutiveSkips: 0, status: 'open',
    },
    {
      id: 'a-4', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '跑回归测试',
      projectId: null, contextIds: [], estMinutes: 20, value: 3, deadline: null,
      consecutiveSkips: 0, status: 'open',
    },
    {
      id: 'a-5', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '反复跳过的行动',
      projectId: null, contextIds: [], estMinutes: 15, value: 3, deadline: null,
      consecutiveSkips: 3, status: 'open',
    },
  ],
  calendar: [
    {
      id: 'cal-1', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '团队站会',
      startsAt: '2026-09-23T01:30:00.000Z', contextIds: [], estMinutes: 15, value: 3,
      consecutiveSkips: 0, status: 'open',
    },
    {
      id: 'cal-2', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '评审会',
      startsAt: '2026-09-24T02:00:00.000Z', contextIds: [], estMinutes: 60, value: 4,
      consecutiveSkips: 0, status: 'open',
    },
    {
      id: 'cal-3', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '反复跳过的日程',
      startsAt: '2026-09-25T03:00:00.000Z', contextIds: [], estMinutes: 30, value: 3,
      consecutiveSkips: 3, status: 'open',
    },
  ],
  waiting: [
    {
      id: 'w-1', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      title: '等供应商报价', waitingOn: '供应商', expectedBy: '2026-09-20',
    },
  ],
  habitDays: [
    {
      id: 'hd-1', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      habitId: 'h-1', localDate: '20260923', status: 'open', consecutiveSkips: 3,
    },
  ],
  habits: [
    {
      id: 'h-1', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      title: '晨间拉伸', actionTitle: '做 10 分钟拉伸', estMinutes: 10, value: 2,
      cycleDays: 21, startedAt: '2026-09-01T00:00:00.000Z', status: 'active',
    },
  ],
  projects: [
    {
      id: 'p-1', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      title: '论文实验', outcome: '跑出 baseline', value: 4, status: 'active',
    },
  ],
};

jest.mock('@nextdo/db', () => {
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    close: async () => undefined,
  };
  return {
    createPowerSyncDatabase: () => powersync,
    createPowerSyncConnector: () => ({
      fetchCredentials: async () => null,
      uploadData: async () => undefined,
    }),
    subscribeAppStream: async () => undefined,
    wrapDb: () => ({}),
    reviewRecordsWatchQuery: jest.fn(() => ({
      compile: () => ({ sql: 'select 1', parameters: [] }),
      execute: async () => [],
    })),
    isReactNativeRuntime: () => false,
    buildDailyReviewSnapshot: jest.fn(async () => dataRef.snapshot),
    listNextActions: jest.fn(async () => dataRef.actions),
    listCalendarActions: jest.fn(async () => dataRef.calendar),
    listWaitingForItems: jest.fn(async () => dataRef.waiting),
    listHabitDays: jest.fn(async () => dataRef.habitDays),
    listHabits: jest.fn(async () => dataRef.habits),
    listProjects: jest.fn(async () => dataRef.projects),
    completeAction: jest.fn(async () => undefined),
    snoozeAction: jest.fn(async () => undefined),
    addReviewRecord: jest.fn(async (db: unknown, record: unknown) => record),
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

import { fireEvent, renderRouter, screen, testRouter, waitFor } from 'expo-router/testing-library';
import { addReviewRecord, completeAction, snoozeAction } from '@nextdo/db';

const mockedCompleteAction = completeAction as jest.Mock;
const mockedSnoozeAction = snoozeAction as jest.Mock;
const mockedAddReviewRecord = addReviewRecord as jest.Mock;

function local8(hour8: string | Date): Date {
  return typeof hour8 === 'string'
    ? new Date(Number(hour8.slice(0, 4)), Number(hour8.slice(5, 7)) - 1, Number(hour8.slice(8, 10)), 8, 0, 0, 0)
    : hour8;
}

function tomorrowAt8(): Date {
  const target = new Date();
  target.setDate(target.getDate() + 1);
  target.setHours(8, 0, 0, 0);
  return target;
}

/**
 * Render the daily review the way the app actually reaches it — pushed from
 * the Review tab — so the submit's final `router.back()` has a parent route
 * to pop to. With `initialUrl: '/review/daily'` alone the GO_BACK action is
 * unhandled; expo-router then THROWS in test mode, and the throw wedges
 * RNTL's fake-timer `waitFor` loop (the test dies on jest's 5s timeout even
 * though every assertion would pass).
 */
function renderDaily() {
  const view = renderRouter('app', { initialUrl: '/review' });
  testRouter.navigate('/review/daily');
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('daily review — rendering', () => {
  it('renders the snapshot sections + the decision rows + the repeated skips', async () => {
    renderRouter('app', { initialUrl: '/review/daily' });

    await waitFor(() => expect(screen.getByText('今日回顾')).toBeTruthy());

    // Snapshot (read-only).
    expect(screen.getByText('收件箱 2 条')).toBeTruthy();
    expect(screen.getByText('今日完成 1 项')).toBeTruthy();
    expect(screen.getByText('缺少行动的项目')).toBeTruthy();
    expect(screen.getByText('论文实验')).toBeTruthy();
    expect(screen.getByText('待跟进（已过期）')).toBeTruthy();
    expect(screen.getByText('等供应商报价 — 等供应商')).toBeTruthy();
    expect(screen.getByText('今日日程')).toBeTruthy();
    // Calendar rows render as one Text: `title（<local date time>）` — match
    // on the title, the formatted time is locale-dependent.
    expect(screen.getByText(/团队站会/)).toBeTruthy();
    expect(screen.getByText('明日日程')).toBeTruthy();
    expect(screen.getByText(/评审会/)).toBeTruthy();

    // Decision rows (stillOpen, in snapshot order).
    expect(screen.getByText('未完成的行动（4）')).toBeTruthy();
    expect(screen.getByText('写周报')).toBeTruthy();
    expect(screen.getByText('整理实验数据')).toBeTruthy();
    expect(screen.getByText('回复邮件')).toBeTruthy();
    expect(screen.getByText('跑回归测试')).toBeTruthy();

    // Repeated skips — all three kinds resolved to titles.
    expect(screen.getByText('反复跳过的行动')).toBeTruthy();
    expect(screen.getByText('晨间拉伸')).toBeTruthy();
    expect(screen.getByText('反复跳过的日程')).toBeTruthy();
    // Reclarify entries only for the non-habit kinds.
    expect(screen.getAllByText('重新明晰')).toHaveLength(2);
  });
});

describe('daily review — submit', () => {
  it('lands the decision transactions FIRST and the record LAST, with the full answers', async () => {
    const view = renderDaily();
    await waitFor(() => expect(screen.getByText('未完成的行动（4）')).toBeTruthy());

    // a-1 → 已完成 · a-2 → 明日必做 · a-3 → 排期 2026-09-25 · a-4 → 跳过
    fireEvent.press(screen.getAllByText('已完成')[0]!);
    fireEvent.press(screen.getAllByText('明日必做')[1]!);
    fireEvent.changeText(screen.getAllByPlaceholderText('排期到 YYYY-MM-DD（08:00）')[2]!, '2026-09-25');
    fireEvent.press(screen.getAllByText('排期')[2]!);
    fireEvent.press(screen.getAllByText('跳过')[3]!);

    fireEvent.press(screen.getByText('提交回顾'));
    await waitFor(() => expect(mockedAddReviewRecord).toHaveBeenCalledTimes(1));

    // 1. completed → completeAction(next, a-1).
    expect(mockedCompleteAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actionKind: 'next', actionId: 'a-1' }),
    );
    // 2. rescheduled → snooze at the picked LOCAL day 08:00.
    const rescheduleCall = mockedSnoozeAction.mock.calls.find(
      (call) => call[1]?.actionId === 'a-3',
    );
    expect(rescheduleCall).toBeDefined();
    expect(rescheduleCall?.[1].actionKind).toBe('next');
    expect(rescheduleCall?.[1].snoozedUntil.getTime()).toBe(local8('2026-09-25').getTime());
    // 3. tomorrow must-do → snooze at TOMORROW 08:00 (local).
    const tomorrowCall = mockedSnoozeAction.mock.calls.find(
      (call) => call[1]?.actionId === 'a-2',
    );
    expect(tomorrowCall).toBeDefined();
    expect(tomorrowCall?.[1].snoozedUntil.getTime()).toBe(tomorrowAt8().getTime());

    // 4. The record — last, with the full snapshot + answers.
    const record = mockedAddReviewRecord.mock.calls[0][1];
    expect(record).toMatchObject({
      kind: 'daily',
      snapshot: dataRef.snapshot,
      answers: {
        completedActionIds: ['a-1'],
        rescheduled: [{ actionId: 'a-3', toDate: local8('2026-09-25').toISOString() }],
        skippedNoted: ['a-4'],
        tomorrowMustDo: ['a-2'],
      },
    });
    // Order: the record lands after every decision transaction.
    const recordOrder = mockedAddReviewRecord.mock.invocationCallOrder[0];
    const lastSnoozeOrder = mockedSnoozeAction.mock.invocationCallOrder.at(-1)!;
    const lastCompleteOrder = mockedCompleteAction.mock.invocationCallOrder.at(-1)!;
    expect(recordOrder).toBeGreaterThan(lastSnoozeOrder);
    expect(recordOrder).toBeGreaterThan(lastCompleteOrder);

    // 5. The final router.back() pops to the Review tab it was pushed from.
    await waitFor(() => expect(view.getPathname()).toBe('/review'));
  });

  it('an invalid reschedule date is rejected with a hint and never reaches the record', async () => {
    renderDaily();
    await waitFor(() => expect(screen.getByText('未完成的行动（4）')).toBeTruthy());

    fireEvent.changeText(screen.getAllByPlaceholderText('排期到 YYYY-MM-DD（08:00）')[0]!, '2026-02-30');
    fireEvent.press(screen.getAllByText('排期')[0]!);
    expect(screen.getByText('日期格式应为 YYYY-MM-DD（例如 2026-09-24）')).toBeTruthy();

    fireEvent.press(screen.getByText('提交回顾'));
    await waitFor(() => expect(mockedAddReviewRecord).toHaveBeenCalledTimes(1));

    expect(mockedSnoozeAction).not.toHaveBeenCalled();
    const record = mockedAddReviewRecord.mock.calls[0][1];
    expect(record.answers.rescheduled).toEqual([]);
  });

  it('a failed decision transaction STOPS the sequence — no record is written', async () => {
    mockedCompleteAction.mockRejectedValueOnce(new Error('boom'));
    renderDaily();
    await waitFor(() => expect(screen.getByText('未完成的行动（4）')).toBeTruthy());

    fireEvent.press(screen.getAllByText('已完成')[0]!);
    fireEvent.press(screen.getByText('提交回顾'));

    await waitFor(() =>
      expect(screen.getByText('提交在中途失败，回顾记录未写入。请检查提示后重新提交。')).toBeTruthy(),
    );
    // The decision-transaction error is surfaced through its hook (the
    // "请检查提示" hint is real, not decorative).
    expect(screen.getByText('boom')).toBeTruthy();
    expect(mockedCompleteAction).toHaveBeenCalledTimes(1);
    expect(mockedAddReviewRecord).not.toHaveBeenCalled();
  });
});
