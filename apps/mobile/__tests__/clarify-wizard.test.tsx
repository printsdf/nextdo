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
        projectId: null,
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

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ValidationNextdoError } from '@nextdo/core';
import { applyClarify, reclarifyAction } from '@nextdo/db';
import { ClarifyWizard, WizardBody } from '../components/clarify-wizard';

const mockedApplyClarify = applyClarify as jest.Mock;
const mockedReclarifyAction = reclarifyAction as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockedApplyClarify.mockResolvedValue({ inboxId: 'inbox-1', outcome: { kind: 'next-action', source: 'clarified' }, createdIds: ['a1'] });
  mockedReclarifyAction.mockResolvedValue({ outcome: { kind: 'next-action', source: 'clarified' }, createdIds: ['a2'] });
});

function renderWizard(
  props: {
    mode?: 'clarify' | 'reclarify';
    id?: string;
    actionKind?: 'next' | 'calendar' | null;
    defaultTitle?: string;
  } = {},
) {
  return render(
    <WizardBody
      mode={props.mode ?? 'clarify'}
      id={props.id ?? 'inbox-1'}
      actionKind={props.actionKind ?? null}
      defaultTitle={props.defaultTitle ?? '订下周去杭州的高铁票'}
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
    render(<WizardBody mode="reclarify" id="act-1" actionKind="next" defaultTitle="写季度总结" />);
    expect(screen.queryByText('可以变成下一步行动吗？')).toBeNull();
    expect(screen.getByText('需要多个步骤才能完成吗？')).toBeTruthy();

    fireEvent.press(screen.getByText('否，一步能完成'));
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
