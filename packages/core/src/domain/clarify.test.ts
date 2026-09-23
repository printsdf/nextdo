import { NEXT_ACTION_DEFAULT_VALUE, classifyInboxItem, type ClarifyAnswers } from './clarify';
import { ValidationNextdoError } from '../lib/errors';

const base: ClarifyAnswers = {
  actionable: true,
  multipleSteps: false,
  twoMinutes: false,
  myResponsibility: true,
  fixedTime: false,
};

describe('classifyInboxItem — Q1 non-actionable branches', () => {
  it('reference', () => {
    expect(classifyInboxItem({ ...base, actionable: false, nonActionableKind: 'reference' })).toEqual({
      kind: 'reference',
    });
  });

  it('someday', () => {
    expect(classifyInboxItem({ ...base, actionable: false, nonActionableKind: 'someday' })).toEqual({
      kind: 'someday',
    });
  });

  it('trash', () => {
    expect(classifyInboxItem({ ...base, actionable: false, nonActionableKind: 'trash' })).toEqual({
      kind: 'trash',
    });
  });

  it('no implicit branch: missing nonActionableKind throws', () => {
    expect(() => classifyInboxItem({ ...base, actionable: false })).toThrow(
      ValidationNextdoError,
    );
    let err: unknown;
    try {
      classifyInboxItem({ ...base, actionable: false });
    } catch (e) {
      err = e;
    }
    expect((err as ValidationNextdoError).code).toBe('clarify.incomplete');
  });
});

describe('classifyInboxItem — Q2 multiple steps', () => {
  it('project with an outcome', () => {
    expect(
      classifyInboxItem({ ...base, multipleSteps: true, projectOutcome: '论文通过答辩' }),
    ).toEqual({ kind: 'project' });
  });

  it('project without an outcome → project.needs-outcome', () => {
    expect(() =>
      classifyInboxItem({ ...base, multipleSteps: true, projectOutcome: '   ' }),
    ).toThrow(ValidationNextdoError);
    expect(() =>
      classifyInboxItem({ ...base, multipleSteps: true, projectOutcome: '   ' }),
    ).toThrow('A project requires an outcome');
    expect(() => classifyInboxItem({ ...base, multipleSteps: true })).toThrow(
      ValidationNextdoError,
    );
    let err: unknown;
    try {
      classifyInboxItem({ ...base, multipleSteps: true });
    } catch (e) {
      err = e;
    }
    expect((err as ValidationNextdoError).code).toBe('project.needs-outcome');
  });
});

describe('classifyInboxItem — Q2b project attach', () => {
  it('a non-empty projectId → next-action (project-attach)', () => {
    expect(classifyInboxItem({ ...base, projectId: 'p-1' })).toEqual({
      kind: 'next-action',
      source: 'project-attach',
    });
  });

  it('priority: projectId beats twoMinutes (attach skips Q3–Q5)', () => {
    expect(
      classifyInboxItem({ ...base, projectId: 'p-1', twoMinutes: true, completedOnTheSpot: false }),
    ).toEqual({ kind: 'next-action', source: 'project-attach' });
  });

  it('priority: multipleSteps beats projectId', () => {
    expect(
      classifyInboxItem({ ...base, multipleSteps: true, projectOutcome: '跑完 baseline', projectId: 'p-1' }),
    ).toEqual({ kind: 'project' });
  });

  it('null / undefined / empty string fall through to the regular chain', () => {
    expect(classifyInboxItem({ ...base, projectId: null })).toEqual({
      kind: 'next-action',
      source: 'clarified',
    });
    expect(classifyInboxItem(base)).toEqual({ kind: 'next-action', source: 'clarified' });
    expect(classifyInboxItem({ ...base, projectId: '' })).toEqual({
      kind: 'next-action',
      source: 'clarified',
    });
  });
});

describe('classifyInboxItem — Q3 two minutes (DO NOW)', () => {
  it('completed on the spot → do-now-completed', () => {
    expect(
      classifyInboxItem({ ...base, twoMinutes: true, completedOnTheSpot: true }),
    ).toEqual({ kind: 'do-now-completed' });
  });

  it('not completed on the spot → next-action (two-minute) with default value 3', () => {
    const outcome = classifyInboxItem({ ...base, twoMinutes: true, completedOnTheSpot: false });
    expect(outcome).toEqual({ kind: 'next-action', source: 'two-minute' });
    expect(NEXT_ACTION_DEFAULT_VALUE).toBe(3);
  });

  it('questions 4–5 do not apply on the two-minute path', () => {
    // myResponsibility / fixedTime values must not change the outcome
    const a = classifyInboxItem({ ...base, twoMinutes: true, myResponsibility: false });
    const b = classifyInboxItem({ ...base, twoMinutes: true, fixedTime: true });
    expect(a).toEqual({ kind: 'next-action', source: 'two-minute' });
    expect(b).toEqual({ kind: 'next-action', source: 'two-minute' });
  });
});

describe('classifyInboxItem — Q4 / Q5', () => {
  it('not my responsibility → waiting-for', () => {
    expect(classifyInboxItem({ ...base, myResponsibility: false })).toEqual({ kind: 'waiting-for' });
  });

  it('my responsibility, fixed time → calendar-action', () => {
    expect(classifyInboxItem({ ...base, fixedTime: true })).toEqual({ kind: 'calendar-action' });
  });

  it('my responsibility, no fixed time → next-action (clarified)', () => {
    expect(classifyInboxItem(base)).toEqual({ kind: 'next-action', source: 'clarified' });
  });
});
