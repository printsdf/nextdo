/**
 * Component tests — the Projects tab + project detail route (PRD R6,
 * design.md §4.4): the list with derived coverage tags, the inline
 * new-project form (required-field gate), the detail's per-project open
 * action rows (client-side projectId filter), and the mutation wiring
 * (complete / add-action carry the right args). The coverage tag FLIP is
 * a db-layer property (watched query re-derives `hasOpenAction` — covered
 * by the packages/db tests); the live flip is walked in the web session.
 */
const dataRef: { projects: unknown[]; nextActions: unknown[] } = {
  projects: [],
  nextActions: [],
};

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
    projectsWatchQuery: compilable,
    listNextActions: async () => dataRef.nextActions,
    addProject: jest.fn(async () => undefined),
    addNextAction: jest.fn(async () => undefined),
    completeAction: jest.fn(async () => undefined),
    snoozeAction: jest.fn(async () => undefined),
    trashAction: jest.fn(async () => undefined),
  };
});

jest.mock('@powersync/react', () => {
  const React = jest.requireActual('react');
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    close: async () => undefined,
  };
  return {
    PowerSyncContext: React.createContext(powersync),
    usePowerSync: () => powersync,
    useQuery: () => ({
      data: dataRef.projects,
      error: undefined,
      isLoading: false,
      isFetching: false,
      refresh: async () => undefined,
    }),
    useStatus: () => ({ status: 'synced', isSynced: true }),
  };
});

import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { addNextAction, addProject, completeAction } from '@nextdo/db';

const mockedAddProject = addProject as jest.Mock;
const mockedAddNextAction = addNextAction as jest.Mock;
const mockedCompleteAction = completeAction as jest.Mock;

const PROJECT = {
  id: 'p-1',
  createdAt: '2026-09-20T01:00:00.000Z',
  updatedAt: '2026-09-20T01:00:00.000Z',
  deletedAt: null,
  title: '论文实验',
  outcome: '跑出 baseline 结果',
  value: 4,
  status: 'active' as const,
};

function action(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'a-1',
    createdAt: '2026-09-20T02:00:00.000Z',
    updatedAt: '2026-09-20T02:00:00.000Z',
    deletedAt: null,
    title: '运行 baseline A',
    projectId: 'p-1',
    contextIds: [],
    estMinutes: 40,
    value: 3,
    category: null,
    dueDate: null,
    deadline: null,
    dependsOnId: null,
    windowStart: null,
    windowEnd: null,
    windowDays: null,
    consecutiveSkips: 0,
    status: 'open',
    sourceInboxId: null,
    replacesActionId: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  dataRef.projects = [
    { ...PROJECT, hasOpenAction: true },
    {
      id: 'p-2',
      createdAt: '2026-09-21T01:00:00.000Z',
      updatedAt: '2026-09-21T01:00:00.000Z',
      deletedAt: null,
      title: '学 Rust',
      outcome: '写一个小 CLI',
      value: 2,
      status: 'on-hold' as const,
      hasOpenAction: false,
    },
  ];
  dataRef.nextActions = [
    action({}),
    action({ id: 'a-2', title: '没有项目的行动', projectId: null }),
    action({ id: 'a-3', title: '已完成的行动', status: 'done' }),
  ];
});

describe('Projects tab', () => {
  it('lists projects with status + coverage tags (Chinese)', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/projects' });

    await waitFor(() => expect(screen.getByText('论文实验')).toBeTruthy());
    expect(screen.getByText('学 Rust')).toBeTruthy();
    expect(screen.getByText('有进行中的行动')).toBeTruthy();
    expect(screen.getByText('缺少行动')).toBeTruthy();
    expect(screen.getByText('进行中')).toBeTruthy();
    expect(screen.getByText('搁置')).toBeTruthy();
  });

  it('the new-project form gates on title + outcome, then calls addProject', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/projects' });
    await waitFor(() => expect(screen.getByText('＋ 新项目')).toBeTruthy());
    fireEvent.press(screen.getByText('＋ 新项目'));

    expect(screen.getByPlaceholderText('项目标题')).toBeTruthy();
    // Empty form: pressing 创建 does nothing.
    fireEvent.press(screen.getByText('创建'));
    await waitFor(() => expect(mockedAddProject).not.toHaveBeenCalled());

    fireEvent.changeText(screen.getByPlaceholderText('项目标题'), '写周报自动化');
    fireEvent.changeText(screen.getByPlaceholderText('完成是什么样（结果）'), '脚本自动汇总');
    fireEvent.press(screen.getByText('创建'));

    await waitFor(() =>
      expect(mockedAddProject).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ title: '写周报自动化', outcome: '脚本自动汇总', value: 3, status: 'active' }),
      ),
    );
  });
});

describe('Project detail', () => {
  it('shows the header and only this project\'s open actions', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });

    await waitFor(() => expect(screen.getByText('运行 baseline A')).toBeTruthy());
    // Header.
    expect(screen.getByText('论文实验')).toBeTruthy();
    expect(screen.getByText('完成是什么样：跑出 baseline 结果')).toBeTruthy();
    expect(screen.getByText('有进行中的行动')).toBeTruthy();
    // Client-side projectId filter: other-project / done actions are out.
    expect(screen.queryByText('没有项目的行动')).toBeNull();
    expect(screen.queryByText('已完成的行动')).toBeNull();
    // Row actions.
    expect(screen.getByText('完成')).toBeTruthy();
    expect(screen.getByText('稍后')).toBeTruthy();
    expect(screen.getByText('删除')).toBeTruthy();
  });

  it('pressing 完成 calls completeAction with the next kind + action id', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('运行 baseline A')).toBeTruthy());

    fireEvent.press(screen.getByText('完成'));

    await waitFor(() =>
      expect(mockedCompleteAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actionKind: 'next', actionId: 'a-1' }),
      ),
    );
  });

  it('the add-action form submits with the projectId and the picked estimate', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('＋ 添加行动')).toBeTruthy());
    fireEvent.press(screen.getByText('＋ 添加行动'));

    expect(screen.getByPlaceholderText('下一步行动（具体的、单步的）')).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText('下一步行动（具体的、单步的）'), '整理实验数据');
    // Pick the 30-minute estimate chip (label is unique among chips).
    fireEvent.press(screen.getByText('30'));
    fireEvent.press(screen.getByText('添加'));

    await waitFor(() =>
      expect(mockedAddNextAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ title: '整理实验数据', estMinutes: 30, projectId: 'p-1', value: 3 }),
      ),
    );
  });

  it('composes a deadline date as local end-of-day ISO (domain deadline is a datetime)', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('＋ 添加行动')).toBeTruthy());
    fireEvent.press(screen.getByText('＋ 添加行动'));

    fireEvent.changeText(screen.getByPlaceholderText('下一步行动（具体的、单步的）'), '整理实验数据');
    fireEvent.press(screen.getByText('30'));
    fireEvent.changeText(screen.getByPlaceholderText('截止（YYYY-MM-DD，可选）'), '2026-10-01');
    fireEvent.press(screen.getByText('添加'));

    await waitFor(() => expect(mockedAddNextAction).toHaveBeenCalledTimes(1));
    expect(mockedAddNextAction.mock.calls[0][1]).toMatchObject({
      title: '整理实验数据',
      estMinutes: 30,
      projectId: 'p-1',
      deadline: new Date(2026, 9, 1, 23, 59, 59).toISOString(),
    });
  });

  it('an impossible deadline date is blocked with a hint and never stored', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('＋ 添加行动')).toBeTruthy());
    fireEvent.press(screen.getByText('＋ 添加行动'));

    fireEvent.changeText(screen.getByPlaceholderText('下一步行动（具体的、单步的）'), '整理实验数据');
    fireEvent.press(screen.getByText('30'));
    fireEvent.changeText(screen.getByPlaceholderText('截止（YYYY-MM-DD，可选）'), '2026-02-30');
    fireEvent.press(screen.getByText('添加'));

    expect(screen.getByText('日期格式应为 YYYY-MM-DD（例如 2026-10-01）')).toBeTruthy();
    expect(mockedAddNextAction).not.toHaveBeenCalled();
  });
});
