/**
 * Component tests — the weekly review route (PRD R7, design.md §4.5):
 * snapshot rendering (project table + stall tags + someday list + schedule),
 * the decision area (status chips / follow-up check-offs / keep-trash /
 * confirmation switches), the fixed SUBMIT ORDER (changed decisions first,
 * the append-only record LAST), and failure-stop (no record on a failed
 * transaction).
 */
const NOW = '2026-09-23T10:00:00.000Z';

const dataRef = {
  snapshot: {
    inboxCount: 1,
    projects: [
      { id: 'p-1', title: '论文实验', hasOpenAction: true, lastProgressAt: '2026-09-20T01:00:00.000Z' },
      { id: 'p-2', title: '学 Rust', hasOpenAction: false, lastProgressAt: null },
    ],
    waitingFollowUps: ['w-1'],
    somedayCount: 2,
    stalledProjects: ['p-2'],
    calendarNext7: ['cal-1'],
  },
  waiting: [
    {
      id: 'w-1', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      title: '等供应商报价', waitingOn: '供应商', expectedBy: '2026-09-20',
    },
  ],
  somedays: [
    { id: 's-1', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '学吉他' },
    { id: 's-2', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '旅行计划' },
  ],
  calendar: [
    {
      id: 'cal-1', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '评审会',
      startsAt: '2026-09-25T02:00:00.000Z', contextIds: [], estMinutes: 60, value: 4,
      consecutiveSkips: 0, status: 'open',
    },
  ],
  projects: [
    {
      id: 'p-1', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      title: '论文实验', outcome: '跑出 baseline', value: 4, status: 'active',
    },
    {
      id: 'p-2', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      title: '学 Rust', outcome: '写一个小 CLI', value: 2, status: 'active',
    },
  ],
};

jest.mock('@nextdo/db', () => {
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    disconnect: async () => undefined,
    close: async () => undefined,
  };
  return {
    createPowerSyncDatabase: () => powersync,
    // R6 startup token check (background, non-blocking): a valid stored
    // token — the screen renders regardless (there is no gate in R6).
    getOwnerToken: async () => 'test-owner-token',
    getStoredBackendConfig: async () => null,
    fetchCredentialsOnce: async () => ({ ok: true, token: 'ps-service-jwt' }),
    setOwnerToken: async () => undefined,
    clearOwnerToken: async () => undefined,
    subscribeToOwnerTokenChange: () => () => undefined,
    createPowerSyncConnector: () => ({
      fetchCredentials: async () => null,
      uploadData: async () => undefined,
    }),
    subscribeAppStream: async () => undefined,
    wrapDb: () => ({}),
    seedDefaultContexts: async () => 0,
    reviewRecordsWatchQuery: jest.fn(() => ({
      compile: () => ({ sql: 'select 1', parameters: [] }),
      execute: async () => [],
    })),
    isReactNativeRuntime: () => false,
    buildWeeklyReviewSnapshot: jest.fn(async () => dataRef.snapshot),
    listWaitingForItems: jest.fn(async () => dataRef.waiting),
    listSomedayMaybeItems: jest.fn(async () => dataRef.somedays),
    listCalendarActions: jest.fn(async () => dataRef.calendar),
    listProjects: jest.fn(async () => dataRef.projects),
    updateProject: jest.fn(async (db: unknown, project: unknown) => project),
    trashSomedayMaybeItem: jest.fn(async () => undefined),
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

import { act, fireEvent, renderRouter, screen, testRouter, waitFor } from 'expo-router/testing-library';
import { addReviewRecord, trashSomedayMaybeItem, updateProject } from '@nextdo/db';

const mockedUpdateProject = updateProject as jest.Mock;
const mockedTrashSomeday = trashSomedayMaybeItem as jest.Mock;
const mockedAddReviewRecord = addReviewRecord as jest.Mock;

/**
 * Render the weekly review the way the app actually reaches it — pushed from
 * the Review tab — so the submit's final `router.back()` has a parent route
 * to pop to. With `initialUrl: '/review/weekly'` alone the GO_BACK action is
 * unhandled; expo-router then THROWS in test mode, which wedges RNTL's
 * fake-timer `waitFor` loop (the test would die on jest's 5s timeout).
 */
async function renderWeekly() {
  const view = renderRouter('app', { initialUrl: '/review' });
  // The root auth gate (prod-deploy R3) renders asynchronously — flush it so
  // /review actually loads before we push /review/weekly onto it (otherwise
  // the submit's router.back() has no parent to pop to). The navigate itself
  // is NOT act-wrapped: expo-router's test router asserts the pathname
  // synchronously, and act() would batch the update past that assertion.
  await act(async () => {});
  testRouter.navigate('/review/weekly');
  await act(async () => {});
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('weekly review — rendering', () => {
  it('renders the snapshot (project table + stall + someday + schedule) and defaults', async () => {
    renderRouter('app', { initialUrl: '/review/weekly' });

    await waitFor(() => expect(screen.getByText('本周回顾')).toBeTruthy());

    // Snapshot cards.
    expect(screen.getByText('收件箱 1 条')).toBeTruthy();
    expect(screen.getByText('Someday 2 条')).toBeTruthy();
    expect(screen.getByText('等供应商报价 — 等供应商')).toBeTruthy();
    expect(screen.getByText('未来 7 天日程')).toBeTruthy();
    // Schedule rows render as one Text: `title（<local date time>）` — match
    // on the title, the formatted time is locale-dependent.
    expect(screen.getByText(/评审会/)).toBeTruthy();

    // Project table: titles, coverage, stall tag (p-2 only), progress.
    expect(screen.getByText('论文实验')).toBeTruthy();
    expect(screen.getByText('学 Rust')).toBeTruthy();
    expect(screen.getByText('有进行中的行动')).toBeTruthy();
    expect(screen.getByText('缺少行动')).toBeTruthy();
    expect(screen.getByText('停滞 ≥ 14 天')).toBeTruthy();
    expect(screen.getAllByText(/最近进展：/)).toHaveLength(2);
    expect(screen.getByText('最近进展：暂无')).toBeTruthy();

    // Status chips default to the current status (both active → 2× 进行中).
    expect(screen.getAllByText('进行中')).toHaveLength(2);

    // Follow-up check-off + the someday keep/trash rows.
    expect(screen.getByText('跟进勾选')).toBeTruthy();
    expect(screen.getByText('已跟进')).toBeTruthy();
    expect(screen.getByText('学吉他')).toBeTruthy();
    expect(screen.getByText('旅行计划')).toBeTruthy();

    // Confirmation switches: inboxCleared derives from inboxCount (1 → 否),
    // calendarReasonable defaults 是.
    expect(screen.getByText('收件箱已清空')).toBeTruthy();
    expect(screen.getByText('日程安排合理')).toBeTruthy();
  });
});

describe('weekly review — submit', () => {
  it('lands the CHANGED decisions first and the record last', async () => {
    const view = await renderWeekly();
    await waitFor(() => expect(screen.getByText('本周回顾')).toBeTruthy());

    // p-1 → 已完成 (first row's chip), s-1 → 删除, inboxCleared → 是.
    fireEvent.press(screen.getAllByText('已完成')[0]!);
    fireEvent.press(screen.getAllByText('删除')[0]!);
    fireEvent.press(screen.getAllByText('否')[0]!);

    fireEvent.press(screen.getByText('提交回顾'));
    await waitFor(() => expect(mockedAddReviewRecord).toHaveBeenCalledTimes(1));

    // Changed project decision → updateProject (full row, status done).
    expect(mockedUpdateProject).toHaveBeenCalledTimes(1);
    expect(mockedUpdateProject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'p-1', status: 'done' }),
    );
    // p-2 unchanged → no second update.
    // Someday trash → trashSomedayMaybeItem(s-1) only.
    expect(mockedTrashSomeday).toHaveBeenCalledTimes(1);
    expect(mockedTrashSomeday).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 's-1' }),
    );

    // The record — last, with the full answers.
    const record = mockedAddReviewRecord.mock.calls[0][1];
    expect(record).toMatchObject({
      kind: 'weekly',
      snapshot: dataRef.snapshot,
      answers: expect.objectContaining({
        inboxCleared: true,
        calendarReasonable: true,
        followUpsRaised: [],
        somedayDecisions: expect.arrayContaining([
          expect.objectContaining({ id: 's-1', to: 'trash' }),
          expect.objectContaining({ id: 's-2', to: 'keep' }),
        ]),
        projectDecisions: expect.arrayContaining([
          expect.objectContaining({ id: 'p-1', to: 'done' }),
          expect.objectContaining({ id: 'p-2', to: 'active' }),
        ]),
      }),
    });

    const recordOrder = mockedAddReviewRecord.mock.invocationCallOrder[0];
    expect(recordOrder).toBeGreaterThan(mockedUpdateProject.mock.invocationCallOrder.at(-1)!);
    expect(recordOrder).toBeGreaterThan(mockedTrashSomeday.mock.invocationCallOrder.at(-1)!);

    // The final router.back() pops to the Review tab it was pushed from.
    await waitFor(() => expect(view.getPathname()).toBe('/review'));
  });

  it('a review with NO changes still writes the record, but runs no transactions', async () => {
    await renderWeekly();
    await waitFor(() => expect(screen.getByText('本周回顾')).toBeTruthy());

    fireEvent.press(screen.getByText('提交回顾'));
    await waitFor(() => expect(mockedAddReviewRecord).toHaveBeenCalledTimes(1));

    expect(mockedUpdateProject).not.toHaveBeenCalled();
    expect(mockedTrashSomeday).not.toHaveBeenCalled();
    const record = mockedAddReviewRecord.mock.calls[0][1];
    expect(record.answers.inboxCleared).toBe(false);
    expect(record.answers.projectDecisions).toEqual([
      { id: 'p-1', to: 'active' },
      { id: 'p-2', to: 'active' },
    ]);
  });

  it('a failed decision transaction STOPS the sequence — no record is written', async () => {
    mockedUpdateProject.mockRejectedValueOnce(new Error('boom'));
    await renderWeekly();
    await waitFor(() => expect(screen.getByText('本周回顾')).toBeTruthy());

    fireEvent.press(screen.getAllByText('已完成')[0]!);
    fireEvent.press(screen.getByText('提交回顾'));

    await waitFor(() =>
      expect(screen.getByText('提交在中途失败，回顾记录未写入。请检查提示后重新提交。')).toBeTruthy(),
    );
    expect(mockedUpdateProject).toHaveBeenCalledTimes(1);
    expect(mockedAddReviewRecord).not.toHaveBeenCalled();
  });
});
