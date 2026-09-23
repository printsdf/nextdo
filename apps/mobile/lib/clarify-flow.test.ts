/**
 * Unit tests — the Clarify / Re-clarify pure state machine (lib/clarify-flow).
 *
 * Covers every decision-table outcome (7), every required-field
 * interception (Chinese messages), the do-now immediate path, the
 * two-minute prefill, and the re-clarify entry (Q2, no Q1 field).
 */
import {
  buildDoNowSubmission,
  buildFormSubmission,
  clarifyReducer,
  composeLocalDateTimeIso,
  createWizardState,
  endOfLocalDayIso,
  outcomeLabel,
  validateForm,
  type FormFields,
  type WizardState,
} from './clarify-flow';

const TITLE = '订下周去杭州的高铁票';

function formState(state: WizardState): Extract<WizardState, { step: 'form' }> {
  if (state.step !== 'form') throw new Error(`expected form step, got ${state.step}`);
  return state;
}

function walkTo(state: WizardState, ...actions: Parameters<typeof clarifyReducer>[1][]): WizardState {
  return actions.reduce<WizardState>((acc, action) => clarifyReducer(acc, action), state);
}

function fill(fields: FormFields, patch: Partial<FormFields>): FormFields {
  return { ...fields, ...patch };
}

const hm = (date: Date): string =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

describe('createWizardState', () => {
  it('clarify starts at q1', () => {
    expect(createWizardState('clarify', TITLE).step).toBe('q1');
  });

  it('reclarify re-enters at q2', () => {
    const state = createWizardState('reclarify', TITLE);
    expect(state.step).toBe('q2');
    expect(state.defaultTitle).toBe(TITLE);
  });
});

describe('outcome 1 — reference (q1 no → 资料)', () => {
  const state = walkTo(createWizardState('clarify', TITLE), { type: 'answer-q1', actionable: false }, {
    type: 'answer-q1b',
    kind: 'reference',
  });

  it('lands on the reference form with the inbox title prefilled', () => {
    const form = formState(state);
    expect(form.form).toBe('reference');
    expect(form.fields.title).toBe(TITLE);
  });

  it('intercepts a missing url (Chinese message)', () => {
    expect(validateForm('reference', formState(state).fields)).toBe('请填写链接（URL）');
  });

  it('submits core answers + target once the url is set', () => {
    const fields = fill(formState(state).fields, { url: 'https://example.com/ticket', note: '周五出发' });
    expect(validateForm('reference', fields)).toBeNull();
    const submission = buildFormSubmission('clarify', 'reference', fields, false);
    expect(submission).toEqual({
      mode: 'clarify',
      answers: {
        actionable: false,
        nonActionableKind: 'reference',
        multipleSteps: false,
        twoMinutes: false,
        myResponsibility: true,
        fixedTime: false,
      },
      target: { title: TITLE, url: 'https://example.com/ticket', note: '周五出发' },
    });
  });
});

describe('outcome 2 — someday (q1 no → 有空再说)', () => {
  const state = walkTo(createWizardState('clarify', TITLE), { type: 'answer-q1', actionable: false }, {
    type: 'answer-q1b',
    kind: 'someday',
  });

  it('passes validation with no note (note is optional)', () => {
    expect(validateForm('someday', formState(state).fields)).toBeNull();
  });

  it('submits the someday answers + optional note target', () => {
    const submission = buildFormSubmission('clarify', 'someday', formState(state).fields, false);
    expect(submission.answers).toMatchObject({ actionable: false, nonActionableKind: 'someday' });
    expect(submission.target).toEqual({ title: TITLE });
  });
});

describe('outcome 3 — trash (q1 no → 删除)', () => {
  const state = walkTo(createWizardState('clarify', TITLE), { type: 'answer-q1', actionable: false }, {
    type: 'answer-q1b',
    kind: 'trash',
  });

  it('submits with an empty target (soft-delete only)', () => {
    expect(validateForm('trash', formState(state).fields)).toBeNull();
    const submission = buildFormSubmission('clarify', 'trash', formState(state).fields, false);
    expect(submission.answers).toMatchObject({ actionable: false, nonActionableKind: 'trash' });
    expect(submission.target).toEqual({});
  });
});

describe('outcome 4 — project (q2 yes → 项目 + 首个行动)', () => {
  const state = walkTo(createWizardState('clarify', TITLE), { type: 'answer-q1', actionable: true }, {
    type: 'answer-q2',
    multipleSteps: true,
  });

  it('intercepts a missing project outcome', () => {
    expect(validateForm('project', formState(state).fields)).toBe('请填写项目结果（"完成"是什么样）');
  });

  it('intercepts a missing estMinutes (after the outcome is set)', () => {
    const fields = fill(formState(state).fields, { projectOutcome: '跑完 baseline' });
    expect(validateForm('project', fields)).toBe('请选择或填写预估时长（分钟）');
  });

  it('submits multipleSteps answers + project target fields', () => {
    const fields = fill(formState(state).fields, {
      projectOutcome: '跑完 baseline',
      projectValue: 4,
      estMinutes: 45,
    });
    expect(validateForm('project', fields)).toBeNull();
    const submission = buildFormSubmission('clarify', 'project', fields, false);
    expect(submission.answers).toMatchObject({ actionable: true, multipleSteps: true, projectOutcome: '跑完 baseline' });
    expect(submission.target).toEqual({
      projectTitle: TITLE,
      projectValue: 4,
      actionTitle: TITLE,
      estMinutes: 45,
    });
  });
});

describe('outcome 5 — waiting-for (q4 no → 等待他人)', () => {
  const state = walkTo(
    createWizardState('clarify', TITLE),
    { type: 'answer-q1', actionable: true },
    { type: 'answer-q2', multipleSteps: false },
    { type: 'answer-q3', twoMinutes: false },
    { type: 'answer-q4', myResponsibility: false },
  );

  it('intercepts a missing waitingOn', () => {
    expect(validateForm('waiting', formState(state).fields)).toBe('请填写在等谁 / 什么');
  });

  it('submits myResponsibility=false + the expectedBy date as end-of-day ISO', () => {
    const fields = fill(formState(state).fields, { waitingOn: '导师', expectedBy: '2026-09-25' });
    expect(validateForm('waiting', fields)).toBeNull();
    const submission = buildFormSubmission('clarify', 'waiting', fields, false);
    expect(submission.answers).toMatchObject({ myResponsibility: false, fixedTime: false });
    expect(submission.target.waitingOn).toBe('导师');
    const expectedBy = new Date(submission.target.expectedBy as string);
    expect(expectedBy.getFullYear()).toBe(2026);
    expect(expectedBy.getMonth()).toBe(8);
    expect(expectedBy.getDate()).toBe(25);
    expect(hm(expectedBy)).toBe('23:59');
  });

  it('intercepts a malformed expectedBy date', () => {
    const fields = fill(formState(state).fields, { waitingOn: '导师', expectedBy: '2026/09/25' });
    expect(validateForm('waiting', fields)).toBe('日期格式应为 YYYY-MM-DD');
  });
});

describe('outcome 6 — calendar-action (q5 yes → 固定时间行动)', () => {
  const state = walkTo(
    createWizardState('clarify', TITLE),
    { type: 'answer-q1', actionable: true },
    { type: 'answer-q2', multipleSteps: false },
    { type: 'answer-q3', twoMinutes: false },
    { type: 'answer-q4', myResponsibility: true },
    { type: 'answer-q5', fixedTime: true },
  );

  it('intercepts a missing startsAt', () => {
    expect(validateForm('calendar', formState(state).fields)).toBe('请选择开始日期和时间');
  });

  it('submits fixedTime answers + the composed local startsAt ISO', () => {
    const fields = fill(formState(state).fields, {
      startsAtDate: '2026-09-25',
      startsAtTime: '09:30',
      estMinutes: 30,
      value: 4,
    });
    expect(validateForm('calendar', fields)).toBeNull();
    const submission = buildFormSubmission('clarify', 'calendar', fields, false);
    expect(submission.answers).toMatchObject({ myResponsibility: true, fixedTime: true, twoMinutes: false });
    const startsAt = new Date(submission.target.startsAt as string);
    expect(startsAt.getFullYear()).toBe(2026);
    expect(startsAt.getMonth()).toBe(8);
    expect(startsAt.getDate()).toBe(25);
    expect(hm(startsAt)).toBe('09:30');
    expect(submission.target).toMatchObject({ estMinutes: 30, value: 4 });
  });
});

describe('outcome 7a — next-action clarified (q5 no)', () => {
  const state = walkTo(
    createWizardState('clarify', TITLE),
    { type: 'answer-q1', actionable: true },
    { type: 'answer-q2', multipleSteps: false },
    { type: 'answer-q3', twoMinutes: false },
    { type: 'answer-q4', myResponsibility: true },
    { type: 'answer-q5', fixedTime: false },
  );

  it('intercepts a missing estMinutes', () => {
    expect(validateForm('action', formState(state).fields)).toBe('请选择或填写预估时长（分钟）');
  });

  it('submits the user value + optional deadline', () => {
    const fields = fill(formState(state).fields, { estMinutes: 20, value: 5, deadline: '2026-09-30' });
    expect(validateForm('action', fields)).toBeNull();
    const submission = buildFormSubmission('clarify', 'action', fields, false);
    expect(submission.answers).toMatchObject({ twoMinutes: false, myResponsibility: true, fixedTime: false });
    expect('completedOnTheSpot' in submission.answers).toBe(false);
    expect(submission.target).toMatchObject({ estMinutes: 20, value: 5 });
    const deadline = new Date(submission.target.deadline as string);
    expect(deadline.getDate()).toBe(30);
    expect(hm(deadline)).toBe('23:59');
  });
});

describe('outcome 7b — two-minute path (q3 yes)', () => {
  it('do-now: buildDoNowSubmission carries completedOnTheSpot (both modes)', () => {
    const clarify = buildDoNowSubmission('clarify');
    expect(clarify.mode).toBe('clarify');
    expect(clarify.answers).toMatchObject({ actionable: true, twoMinutes: true, completedOnTheSpot: true });
    expect(clarify.target).toEqual({});
    const reclarify = buildDoNowSubmission('reclarify');
    expect(reclarify.mode).toBe('reclarify');
    expect(reclarify.answers).toMatchObject({ twoMinutes: true, completedOnTheSpot: true });
    expect('actionable' in reclarify.answers).toBe(false);
  });

  it('regression: the reducer accepts "done" from q3b (the do-now path submits without a form)', () => {
    const atQ3b = walkTo(
      createWizardState('clarify', TITLE),
      { type: 'answer-q1', actionable: true },
      { type: 'answer-q2', multipleSteps: false },
      { type: 'answer-q3', twoMinutes: true },
    );
    expect(atQ3b.step).toBe('q3b');
    const done = clarifyReducer(atQ3b, {
      type: 'done',
      result: { outcome: { kind: 'do-now-completed' }, createdIds: ['r1'] },
    });
    expect(done.step).toBe('done');
    if (done.step === 'done') {
      expect(done.result.outcome.kind).toBe('do-now-completed');
      // The terminal step absorbs any further actions.
      expect(clarifyReducer(done, { type: 'answer-q1', actionable: true }).step).toBe('done');
    }
  });

  it('not done on the spot: the action form prefills estMinutes = 2', () => {
    const state = walkTo(
      createWizardState('clarify', TITLE),
      { type: 'answer-q1', actionable: true },
      { type: 'answer-q2', multipleSteps: false },
      { type: 'answer-q3', twoMinutes: true },
      { type: 'answer-q3b', completedOnTheSpot: false },
    );
    const form = formState(state);
    expect(form.form).toBe('action');
    expect(form.twoMinute).toBe(true);
    expect(form.fields.estMinutes).toBe(2);
  });

  it('the two-minute submission omits value (fixed spec default) and sets completedOnTheSpot=false', () => {
    const state = walkTo(
      createWizardState('clarify', TITLE),
      { type: 'answer-q1', actionable: true },
      { type: 'answer-q2', multipleSteps: false },
      { type: 'answer-q3', twoMinutes: true },
      { type: 'answer-q3b', completedOnTheSpot: false },
    );
    const form = formState(state);
    expect(validateForm('action', form.fields)).toBeNull();
    const submission = buildFormSubmission('clarify', 'action', form.fields, true);
    expect(submission.answers).toMatchObject({ twoMinutes: true, completedOnTheSpot: false });
    expect('value' in (submission.target as Record<string, unknown>)).toBe(false);
    expect(submission.target).toMatchObject({ estMinutes: 2, title: TITLE });
  });
});

describe('reclarify mode (q2 起)', () => {
  it('walks q2 → project and its answers carry NO actionable field', () => {
    const state = walkTo(createWizardState('reclarify', TITLE), { type: 'answer-q2', multipleSteps: true });
    const form = formState(state);
    const fields = fill(form.fields, { projectOutcome: '新结果', estMinutes: 30 });
    const submission = buildFormSubmission('reclarify', 'project', fields, false);
    expect(submission.mode).toBe('reclarify');
    expect('actionable' in submission.answers).toBe(false);
    expect(submission.answers).toMatchObject({ multipleSteps: true, projectOutcome: '新结果' });
  });

  it('throws for the Q1-only forms (unreachable in reclarify)', () => {
    const fields = formState(
      walkTo(createWizardState('reclarify', TITLE), { type: 'answer-q2', multipleSteps: true }),
    ).fields;
    expect(() => buildFormSubmission('reclarify', 'reference', fields, false)).toThrow();
    expect(() => buildFormSubmission('reclarify', 'someday', fields, false)).toThrow();
    expect(() => buildFormSubmission('reclarify', 'trash', fields, false)).toThrow();
  });
});

describe('reducer mechanics', () => {
  it('ignores actions that do not match the current step', () => {
    const state = createWizardState('clarify', TITLE);
    expect(clarifyReducer(state, { type: 'answer-q5', fixedTime: true })).toBe(state);
    expect(clarifyReducer(state, { type: 'field', field: 'url', value: 'x' })).toBe(state);
  });

  it('field updates replace the value and clear a previous error', () => {
    const form = formState(
      walkTo(createWizardState('clarify', TITLE), { type: 'answer-q1', actionable: false }, {
        type: 'answer-q1b',
        kind: 'reference',
      }),
    );
    const withError = clarifyReducer(form, { type: 'form-error', error: '请填写链接（URL）' });
    expect(withError.step === 'form' ? withError.error : null).toBe('请填写链接（URL）');
    const updated = clarifyReducer(withError, { type: 'field', field: 'url', value: 'https://x' });
    expect(updated.step === 'form' ? updated.fields.url : null).toBe('https://x');
    expect(updated.step === 'form' ? updated.error : null).toBeNull();
  });

  it('the done step is terminal', () => {
    const form = formState(
      walkTo(createWizardState('clarify', TITLE), { type: 'answer-q1', actionable: false }, {
        type: 'answer-q1b',
        kind: 'someday',
      }),
    );
    const result = { outcome: { kind: 'someday' } as const, createdIds: ['id-1'] };
    const done = clarifyReducer(form, { type: 'done', result });
    expect(done).toEqual({ mode: 'clarify', defaultTitle: TITLE, step: 'done', result });
    expect(clarifyReducer(done, { type: 'answer-q1', actionable: true })).toBe(done);
  });
});

describe('validateForm edge cases', () => {
  const base: FormFields = {
    title: TITLE,
    url: '',
    note: '',
    waitingOn: '',
    expectedBy: '',
    projectTitle: TITLE,
    projectOutcome: '',
    projectValue: 3,
    actionTitle: TITLE,
    estMinutes: null,
    value: 3,
    deadline: '',
    startsAtDate: '',
    startsAtTime: '',
  };

  it('intercepts an empty title on every form', () => {
    const empty = fill(base, { title: '   ' });
    expect(validateForm('someday', empty)).toBe('标题不能为空');
  });

  it('rejects estMinutes of 0 / negative / fractional / > 1440', () => {
    for (const bad of [0, -5, 2.5, 1441]) {
      expect(validateForm('action', fill(base, { estMinutes: bad }))).toBe('请选择或填写预估时长（分钟）');
    }
    expect(validateForm('action', fill(base, { estMinutes: 1440 }))).toBeNull();
  });

  it('intercepts a malformed deadline on the action form', () => {
    expect(validateForm('action', fill(base, { estMinutes: 10, deadline: '30-09-2026' }))).toBe(
      '日期格式应为 YYYY-MM-DD',
    );
  });
});

describe('date composition helpers', () => {
  it('endOfLocalDayIso maps a date to local 23:59:59', () => {
    const iso = endOfLocalDayIso('2026-09-25');
    expect(iso).not.toBeNull();
    const date = new Date(iso as string);
    expect(`${date.getMonth() + 1}-${date.getDate()}`).toBe('9-25');
    expect(`${hm(date)}:${String(date.getSeconds()).padStart(2, '0')}`).toBe('23:59:59');
  });

  it('endOfLocalDayIso rejects malformed values', () => {
    expect(endOfLocalDayIso('')).toBeNull();
    expect(endOfLocalDayIso('2026-13-01')).toBeNull();
    expect(endOfLocalDayIso('not-a-date')).toBeNull();
  });

  it('composeLocalDateTimeIso maps date+time to a local datetime ISO', () => {
    const iso = composeLocalDateTimeIso('2026-09-25', '09:30');
    expect(iso).not.toBeNull();
    const date = new Date(iso as string);
    expect(hm(date)).toBe('09:30');
  });

  it('composeLocalDateTimeIso rejects malformed times', () => {
    expect(composeLocalDateTimeIso('2026-09-25', '25:00')).toBeNull();
    expect(composeLocalDateTimeIso('2026-09-25', '9:5')).toBeNull();
    expect(composeLocalDateTimeIso('2026-09-25', '')).toBeNull();
  });
});

describe('outcomeLabel (Chinese summary for the done step)', () => {
  it('labels every outcome kind', () => {
    expect(outcomeLabel({ kind: 'reference' })).toBe('资料');
    expect(outcomeLabel({ kind: 'someday' })).toBe('有空再说');
    expect(outcomeLabel({ kind: 'trash' })).toContain('删除');
    expect(outcomeLabel({ kind: 'do-now-completed' })).toBe('当场完成');
    expect(outcomeLabel({ kind: 'project' })).toBe('项目 + 首个行动');
    expect(outcomeLabel({ kind: 'waiting-for' })).toBe('等待他人');
    expect(outcomeLabel({ kind: 'calendar-action' })).toBe('固定时间行动');
    expect(outcomeLabel({ kind: 'next-action', source: 'clarified' })).toBe('下一步行动');
    expect(outcomeLabel({ kind: 'next-action', source: 'two-minute' })).toBe('下一步行动');
  });
});
