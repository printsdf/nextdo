/**
 * Component tests — the Clarify / Re-clarify wizard (components/clarify-wizard).
 *
 * The step machine itself is unit-tested in lib/clarify-flow.test.ts; here
 * we render the component with the db mocked at the package boundary and
 * cover: step walking, the required-field interception (Chinese copy),
 * the do-now immediate path, the reclarify Q2 entry, and the submit
 * success/failure → done/error rendering.
 */
jest.mock('@nextdo/db', () => {
  return {
    applyClarify: jest.fn(),
    reclarifyAction: jest.fn(),
    listInboxItems: jest.fn(async () => [
      {
        id: 'inbox-1',
        createdAt: '2026-09-22T02:00:00.000Z',
        updatedAt: '2026-09-22T02:00:00.000Z',
        deletedAt: null,
        title: '订下周去杭州的高铁票',
        capturedAt: '2026-09-22T02:00:00.000Z',
      },
    ]),
    listNextActions: jest.fn(async () => [
      {
        id: 'act-1',
        createdAt: '2026-09-22T02:00:00.000Z',
        updatedAt: '2026-09-22T02:00:00.000Z',
        deletedAt: null,
        title: '写季度总结',
        projectId: 'proj-1',
        contextIds: [],
        estMinutes: 30,
        value: 3,
        category: null,
        dueDate: null,
        deadline: null,
        dependsOnId: null,
        windowStart: null,
        windowEnd: null,
        windowDays: null,
        consecutiveSkips: 3,
        status: 'open',
        sourceInboxId: null,
        replacesActionId: null,
      },
    ]),
    listCalendarActions: jest.fn(async () => []),
    wrapDb: () => ({}),
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
    useQuery: () => ({ data: [], error: undefined }),
    useStatus: () => ({ status: 'synced', isSynced: true }),
  };
});

// Q2b's project list — one active (attachable) + one on-hold (filtered
// out by the wizard). proj-1 is act-1's current project (reclarify marker).
jest.mock('@/hooks/use-projects', () => ({ useProjects: jest.fn() }));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), navigate: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ValidationNextdoError } from '@nextdo/core';
import { applyClarify, reclarifyAction } from '@nextdo/db';
import { router } from 'expo-router';
import { useProjects } from '@/hooks/use-projects';
import { ClarifyWizard, WizardBody } from '../components/clarify-wizard';

const mockedApplyClarify = applyClarify as jest.Mock;
const mockedReclarifyAction = reclarifyAction as jest.Mock;
const mockedUseProjects = useProjects as jest.Mock;

const ACTIVE_PROJECT = {
  id: 'proj-1',
  createdAt: '2026-09-22T02:00:00.000Z',
  updatedAt: '2026-09-22T02:00:00.000Z',
  deletedAt: null,
  title: '毕业论文实验',
  outcome: 'baseline A/B 跑完并写入论文 §4',
  value: 4,
  status: 'active',
  hasOpenAction: true,
};
const ON_HOLD_PROJECT = {
  ...ACTIVE_PROJECT,
  id: 'proj-2',
  title: '搬家计划',
  value: 2,
  status: 'on-hold',
  hasOpenAction: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseProjects.mockReturnValue({ data: [ACTIVE_PROJECT, ON_HOLD_PROJECT], error: null });
  mockedApplyClarify.mockResolvedValue({ inboxId: 'inbox-1', outcome: { kind: 'next-action', source: 'clarified' }, createdIds: ['a1'] });
  mockedReclarifyAction.mockResolvedValue({ outcome: { kind: 'next-action', source: 'clarified' }, createdIds: ['a2'] });
});

function renderWizard(
  props: {
    mode?: 'clarify' | 'reclarify';
    id?: string;
    actionKind?: 'next' | 'calendar' | null;
    defaultTitle?: string;
    currentProjectId?: string | null;
  } = {},
) {
  return render(
    <WizardBody
      mode={props.mode ?? 'clarify'}
      id={props.id ?? 'inbox-1'}
      actionKind={props.actionKind ?? null}
      defaultTitle={props.defaultTitle ?? '订下周去杭州的高铁票'}
      currentProjectId={props.currentProjectId ?? null}
    />,
  );
}

describe('WizardBody — step walking (clarify)', () => {
  it('walks q1 → q2 → the project form and submits applyClarify', async () => {
    mockedApplyClarify.mockResolvedValue({ inboxId: 'inbox-1', outcome: { kind: 'project' }, createdIds: ['p1', 'a1'] });
    renderWizard();
    expect(screen.getByText('可以变成下一步行动吗？')).toBeTruthy();

    fireEvent.press(screen.getByText('可以，是行动'));
    expect(screen.getByText('需要多个步骤才能完成吗？')).toBeTruthy();

    fireEvent.press(screen.getByText('是，拆成项目'));
    expect(screen.getByText('项目名')).toBeTruthy();
    expect(screen.getByPlaceholderText('用一句话描述完成的样貌')).toBeTruthy();

    // Required-field interception: empty outcome + no estimate → Chinese error,
    // no transaction.
    fireEvent.press(screen.getByText('保存'));
    expect(screen.getByText('请填写项目结果（"完成"是什么样）')).toBeTruthy();
    expect(mockedApplyClarify).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByPlaceholderText('用一句话描述完成的样貌'), '完成订票');
    fireEvent.press(screen.getByText('保存'));
    expect(screen.getByText('请选择或填写预估时长（分钟）')).toBeTruthy();
    expect(mockedApplyClarify).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('10 分钟'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(mockedApplyClarify).toHaveBeenCalledTimes(1));
    const call = mockedApplyClarify.mock.calls[0][1];
    expect(call.inboxId).toBe('inbox-1');
    expect(call.answers).toMatchObject({
      actionable: true,
      multipleSteps: true,
      projectOutcome: '完成订票',
      twoMinutes: false,
      myResponsibility: true,
      fixedTime: false,
    });
    expect(call.target).toMatchObject({
      projectTitle: '订下周去杭州的高铁票',
      projectValue: 3,
      actionTitle: '订下周去杭州的高铁票',
      estMinutes: 10,
    });

    // Done step shows the Chinese outcome summary.
    await waitFor(() => expect(screen.getByText('已整理为「项目 + 首个行动」')).toBeTruthy());
  });

  it('the do-now path (q3 yes → q3b yes) submits immediately, no form', async () => {
    mockedApplyClarify.mockResolvedValue({ inboxId: 'inbox-1', outcome: { kind: 'do-now-completed' }, createdIds: ['r1'] });
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    fireEvent.press(screen.getByText('否，一步能完成'));
    // q2 (no) now leads to Q2b — opt out of a project to reach Q3.
    fireEvent.press(screen.getByText('不属于项目'));
    expect(screen.getByText('大约 2 分钟内能完成吗？')).toBeTruthy();
    fireEvent.press(screen.getByText('是，2 分钟内'));
    expect(screen.getByText('现在就做掉吗？')).toBeTruthy();
    fireEvent.press(screen.getByText('是，现在就做完'));

    await waitFor(() => expect(mockedApplyClarify).toHaveBeenCalledTimes(1));
    const call = mockedApplyClarify.mock.calls[0][1];
    expect(call.answers).toMatchObject({
      actionable: true,
      multipleSteps: false,
      twoMinutes: true,
      completedOnTheSpot: true,
      myResponsibility: true,
      fixedTime: false,
    });
    await waitFor(() => expect(screen.getByText('已整理为「当场完成」')).toBeTruthy());
  });

  it('a failing transaction surfaces the Chinese mapped error, no done step', async () => {
    mockedApplyClarify.mockRejectedValue(new ValidationNextdoError('action.not-found', 'No live next action with id x'));
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    fireEvent.press(screen.getByText('否，一步能完成'));
    // q2 (no) now leads to Q2b — opt out of a project to reach Q3.
    fireEvent.press(screen.getByText('不属于项目'));
    expect(screen.getByText('大约 2 分钟内能完成吗？')).toBeTruthy();
    fireEvent.press(screen.getByText('否'));
    expect(screen.getByText('应该由你完成吗？')).toBeTruthy();
    fireEvent.press(screen.getByText('是，我的事'));
    expect(screen.getByText('必须在固定日期/时间执行吗？')).toBeTruthy();
    fireEvent.press(screen.getByText('否，普通行动'));
    // action form: est prefill is null → pick one, then submit.
    fireEvent.press(screen.getByLabelText('10 分钟'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(screen.getByText('这个行动不存在了（可能已被删除）')).toBeTruthy());
    expect(screen.queryByText(/已整理为/)).toBeNull();
  });
});

describe('WizardBody — reclarify entry', () => {
  it('re-enters at q2 (no q1) and submits reclarifyAction', async () => {
    render(
      <WizardBody
        mode="reclarify"
        id="act-1"
        actionKind="next"
        defaultTitle="写季度总结"
        currentProjectId="proj-1"
      />,
    );
    expect(screen.queryByText('可以变成下一步行动吗？')).toBeNull();
    expect(screen.getByText('需要多个步骤才能完成吗？')).toBeTruthy();

    fireEvent.press(screen.getByText('否，一步能完成'));
    // q2 (no) now leads to Q2b — opt out of a project to reach Q3.
    fireEvent.press(screen.getByText('不属于项目'));
    expect(screen.getByText('大约 2 分钟内能完成吗？')).toBeTruthy();
    fireEvent.press(screen.getByText('否'));
    expect(screen.getByText('应该由你完成吗？')).toBeTruthy();
    fireEvent.press(screen.getByText('是，我的事'));
    expect(screen.getByText('必须在固定日期/时间执行吗？')).toBeTruthy();
    fireEvent.press(screen.getByText('否，普通行动'));
    fireEvent.press(screen.getByLabelText('20 分钟'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(mockedReclarifyAction).toHaveBeenCalledTimes(1));
    const call = mockedReclarifyAction.mock.calls[0][1];
    expect(call.actionKind).toBe('next');
    expect(call.actionId).toBe('act-1');
    expect(call.answers).toMatchObject({
      multipleSteps: false,
      twoMinutes: false,
      myResponsibility: true,
      fixedTime: false,
    });
    expect('actionable' in call.answers).toBe(false);
    expect(call.target).toMatchObject({ title: '写季度总结', estMinutes: 20 });
  });
});

describe('ClarifyWizard — title loading', () => {
  it('loads the inbox item title, then shows the wizard', async () => {
    render(<ClarifyWizard mode="clarify" id="inbox-1" />);
    await waitFor(() => expect(screen.getByText('可以变成下一步行动吗？')).toBeTruthy());
  });

  it('reclarify loads the existing action title into the forms', async () => {
    render(<ClarifyWizard mode="reclarify" id="act-1" actionKind="next" />);
    await waitFor(() => expect(screen.getByText('需要多个步骤才能完成吗？')).toBeTruthy());
    fireEvent.press(screen.getByText('否，一步能完成'));
    fireEvent.press(screen.getByText('不属于项目'));
    fireEvent.press(screen.getByText('否'));
    fireEvent.press(screen.getByText('是，我的事'));
    fireEvent.press(screen.getByText('否，普通行动'));
    const titleInput = screen.getByDisplayValue('写季度总结');
    expect(titleInput).toBeTruthy();
  });

  it('a missing target shows the not-found state with a back button', async () => {
    render(<ClarifyWizard mode="clarify" id="inbox-missing" />);
    await waitFor(() => expect(screen.getByText('这条收件箱记录不存在了')).toBeTruthy());
    expect(screen.getByText('返回')).toBeTruthy();
  });

  it('reclarify without a resolvable kind shows the unsupported state (no infinite loading)', async () => {
    render(<ClarifyWizard mode="reclarify" id="act-1" actionKind={null} />);
    await waitFor(
      () => expect(screen.getByText('这个行动不能重新明晰（习惯请编辑习惯本身）')).toBeTruthy(),
    );
    expect(screen.queryByText('加载中…')).toBeNull();
  });
});

describe('WizardBody — q2b project ownership', () => {
  function walkToQ2b(mode: 'clarify' | 'reclarify' = 'clarify') {
    renderWizard({ mode, currentProjectId: mode === 'reclarify' ? 'proj-1' : null });
    if (mode === 'clarify') fireEvent.press(screen.getByText('可以，是行动'));
    // Re-clarify re-enters at Q2 — there is no Q1.
    fireEvent.press(screen.getByText('否，一步能完成'));
    expect(screen.getByText('它属于哪个项目？')).toBeTruthy();
  }

  it('lists only ACTIVE projects (value shown); on-hold is filtered out', () => {
    walkToQ2b();
    expect(screen.getByText('毕业论文实验（价值 4）')).toBeTruthy();
    expect(screen.queryByText(/搬家计划/)).toBeNull();
    expect(screen.getByText('新建项目')).toBeTruthy();
    expect(screen.getByText('不属于项目')).toBeTruthy();
  });

  it('attaching opens the action form with the read-only project row and the value prefilled', async () => {
    walkToQ2b();
    fireEvent.press(screen.getByLabelText('挂到项目：毕业论文实验'));
    // The action form shows the fixed attachment (read-only) and skips Q3–Q5.
    expect(screen.getByText('所属项目：毕业论文实验')).toBeTruthy();
    expect(screen.getByText('记成一个行动')).toBeTruthy();
    expect(screen.queryByText('大约 2 分钟内能完成吗？')).toBeNull();

    fireEvent.press(screen.getByLabelText('10 分钟'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(mockedApplyClarify).toHaveBeenCalledTimes(1));
    const call = mockedApplyClarify.mock.calls[0][1];
    expect(call.answers).toMatchObject({ projectId: 'proj-1', twoMinutes: false, fixedTime: false });
    // The value defaults to the project's value (4) — the user did not change it.
    expect(call.target).toMatchObject({ value: 4, estMinutes: 10 });
  });

  it('re-clarify marks the action\'s current project (可保持 / 改挂 / 解除)', () => {
    walkToQ2b('reclarify');
    expect(screen.getByText('当前')).toBeTruthy();
  });

  it('no projects → only the two fallback buttons', () => {
    mockedUseProjects.mockReturnValue({ data: [], error: null });
    walkToQ2b();
    expect(screen.queryByLabelText('挂到项目：毕业论文实验')).toBeNull();
    expect(screen.getByText('新建项目')).toBeTruthy();
    expect(screen.getByText('不属于项目')).toBeTruthy();
  });
});

describe('WizardBody — done step (explicit exits, no auto-back)', () => {
  async function walkToDone() {
    mockedApplyClarify.mockResolvedValue({ inboxId: 'inbox-1', outcome: { kind: 'do-now-completed' }, createdIds: ['r1'] });
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    fireEvent.press(screen.getByText('否，一步能完成'));
    fireEvent.press(screen.getByText('不属于项目'));
    fireEvent.press(screen.getByText('是，2 分钟内'));
    fireEvent.press(screen.getByText('是，现在就做完'));
    await waitFor(() => expect(screen.getByText('已整理为「当场完成」')).toBeTruthy());
  }

  it('shows 再记一条 / 完成 and does NOT auto-return', async () => {
    await walkToDone();
    expect(screen.getByText('再记一条')).toBeTruthy();
    expect(screen.getByText('完成')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('再记一条 → navigate to the inbox tab with recapture=1', async () => {
    await walkToDone();
    fireEvent.press(screen.getByText('再记一条'));
    expect(router.navigate).toHaveBeenCalledWith({ pathname: '/(tabs)/inbox', params: { recapture: '1' } });
  });

  it('完成 → router.back (same shape in reclarify mode)', async () => {
    mockedReclarifyAction.mockResolvedValue({ outcome: { kind: 'do-now-completed' }, createdIds: [] });
    renderWizard({ mode: 'reclarify', id: 'act-1', actionKind: 'next', currentProjectId: 'proj-1' });
    fireEvent.press(screen.getByText('否，一步能完成'));
    fireEvent.press(screen.getByText('不属于项目'));
    fireEvent.press(screen.getByText('是，2 分钟内'));
    fireEvent.press(screen.getByText('是，现在就做完'));
    await waitFor(() => expect(screen.getByText('已整理为「当场完成」')).toBeTruthy());
    fireEvent.press(screen.getByText('完成'));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
