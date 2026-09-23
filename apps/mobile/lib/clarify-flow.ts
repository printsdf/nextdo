/**
 * The Clarify / Re-clarify wizard — a PURE state machine (design.md §4.3).
 *
 * The wizard walks core's Clarify decision table one question at a time
 * (Q1 actionable? → Q1b kind / Q2 multiple steps? → Q3 ~2 min? → Q3b
 * completed on the spot? / Q4 my responsibility? → Q5 fixed time?). This
 * module holds:
 *
 * - the reducer (`clarifyReducer`) — forwards only; the system back button
 *   walks the stack, the reducer never moves backwards;
 * - form-field collection + pre-submit validation (Chinese messages — the
 *   db layer re-validates with typed NextdoError codes);
 * - the submission builders (`buildFormSubmission` / `buildDoNowSubmission`)
 *   that turn a finished form into core's `ClarifyAnswers` /
 *   `ReclarifyAnswers` + the db layer's `ClarifyTarget`.
 *
 * No React, no DB here: the screen owns `useReducer` and calls the
 * packages/db transaction once, then dispatches `{ type: 'done' }`.
 *
 * Re-clarify mode re-enters the table at Q2 (core `ReclarifyAnswers` has no
 * Q1 field) — `createWizardState('reclarify', …)` starts at Q2.
 */
import type { ClarifyAnswers, ClarifyOutcome, Value } from '@nextdo/core';
import type { ClarifyTarget, ReclarifyAnswers } from '@nextdo/db';

export type WizardMode = 'clarify' | 'reclarify';

export type FormKind = 'reference' | 'someday' | 'trash' | 'project' | 'waiting' | 'calendar' | 'action';

/**
 * Every form field the wizard may collect (design.md §4.3 "表单字段").
 * `''` = unset for optional text/date fields; `estMinutes: null` = not
 * chosen yet. Dates are device-local `YYYY-MM-DD`, the calendar time is
 * `HH:mm` (composed into an ISO datetime at submission — see
 * `composeLocalDateTimeIso`).
 */
export interface FormFields {
  title: string;
  url: string;
  note: string;
  waitingOn: string;
  expectedBy: string;
  projectTitle: string;
  projectOutcome: string;
  projectValue: Value;
  actionTitle: string;
  estMinutes: number | null;
  value: Value;
  deadline: string;
  startsAtDate: string;
  startsAtTime: string;
}

export interface WizardResult {
  outcome: ClarifyOutcome;
  createdIds: string[];
}

interface WizardBase {
  mode: WizardMode;
  /** The InboxItem title (re-clarify: the existing action's title) — the
   *  default for every editable title field. */
  defaultTitle: string;
}

export type WizardState = WizardBase &
  (
    | { step: 'q1' }
    | { step: 'q1b' }
    | { step: 'q2' }
    | { step: 'q3' }
    | { step: 'q3b' }
    | { step: 'q4' }
    | { step: 'q5' }
    | {
        step: 'form';
        form: FormKind;
        fields: FormFields;
        error: string | null;
        /** True when the 'action' form was reached via Q3 (~2 min) —
         *  selects the two-minute answers branch at submission. */
        twoMinute: boolean;
      }
    | { step: 'done'; result: WizardResult }
  );

export type WizardAction =
  | { type: 'answer-q1'; actionable: boolean }
  | { type: 'answer-q1b'; kind: 'reference' | 'someday' | 'trash' }
  | { type: 'answer-q2'; multipleSteps: boolean }
  | { type: 'answer-q3'; twoMinutes: boolean }
  /** Only the "not completed on the spot" branch — Q3b-YES is an immediate
   *  submission (`buildDoNowSubmission`), it never parks in a form. */
  | { type: 'answer-q3b'; completedOnTheSpot: false }
  | { type: 'answer-q4'; myResponsibility: boolean }
  | { type: 'answer-q5'; fixedTime: boolean }
  | { type: 'field'; field: keyof FormFields; value: string | number | null }
  | { type: 'form-error'; error: string | null }
  | { type: 'done'; result: WizardResult };

function emptyFields(defaultTitle: string): FormFields {
  return {
    title: defaultTitle,
    url: '',
    note: '',
    waitingOn: '',
    expectedBy: '',
    projectTitle: defaultTitle,
    projectOutcome: '',
    projectValue: 3,
    actionTitle: defaultTitle,
    estMinutes: null,
    value: 3,
    deadline: '',
    startsAtDate: '',
    startsAtTime: '',
  };
}

/** Entry state: clarify starts at Q1, re-clarify re-enters at Q2. */
export function createWizardState(mode: WizardMode, defaultTitle: string): WizardState {
  const base: WizardBase = { mode, defaultTitle };
  return mode === 'clarify' ? { ...base, step: 'q1' } : { ...base, step: 'q2' };
}

function toForm(state: WizardBase, form: FormKind, twoMinute: boolean, estDefault: number | null): WizardState {
  const fields = emptyFields(state.defaultTitle);
  if (estDefault !== null) fields.estMinutes = estDefault;
  return { ...state, step: 'form', form, fields, error: null, twoMinute };
}

export function clarifyReducer(state: WizardState, action: WizardAction): WizardState {
  // Terminal — no further navigation within the wizard.
  if (state.step === 'done') return state;
  // 'done' can be dispatched from ANY step (the form steps, and the do-now
  // path straight from q3b) — the screen submits the db transaction first.
  if (action.type === 'done') {
    return { mode: state.mode, defaultTitle: state.defaultTitle, step: 'done', result: action.result };
  }
  switch (state.step) {
    case 'q1':
      if (action.type === 'answer-q1') {
        return action.actionable ? { ...state, step: 'q2' } : { ...state, step: 'q1b' };
      }
      return state;
    case 'q1b':
      if (action.type === 'answer-q1b') {
        return toForm(state, action.kind, false, null);
      }
      return state;
    case 'q2':
      if (action.type === 'answer-q2') {
        return action.multipleSteps ? toForm(state, 'project', false, null) : { ...state, step: 'q3' };
      }
      return state;
    case 'q3':
      if (action.type === 'answer-q3') {
        return action.twoMinutes ? { ...state, step: 'q3b' } : { ...state, step: 'q4' };
      }
      return state;
    case 'q3b':
      if (action.type === 'answer-q3b') {
        // Two-minute, not done on the spot → an action form, est prefilled
        // with the spec default (2 min); value stays the fixed default (the
        // submission omits it — core keeps 3 / the re-clarify old value).
        return toForm(state, 'action', true, 2);
      }
      return state;
    case 'q4':
      if (action.type === 'answer-q4') {
        return action.myResponsibility ? { ...state, step: 'q5' } : toForm(state, 'waiting', false, null);
      }
      return state;
    case 'q5':
      if (action.type === 'answer-q5') {
        return action.fixedTime ? toForm(state, 'calendar', false, null) : toForm(state, 'action', false, null);
      }
      return state;
    case 'form':
      switch (action.type) {
        case 'field': {
          const fields = { ...state.fields };
          (fields as Record<string, string | number | null>)[action.field] = action.value;
          return { ...state, fields, error: null };
        }
        case 'form-error':
          return { ...state, error: action.error };
        default:
          return state;
      }
  }
}

// ---------------------------------------------------------------------------
// Pre-submit validation (Chinese; the db layer re-checks with typed codes)
// ---------------------------------------------------------------------------

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** 'YYYY-MM-DD' → ISO datetime at 23:59:59 device-local (end of that day). */
export function endOfLocalDayIso(dateOnly: string): string | null {
  const parts = parseDateOnly(dateOnly);
  if (parts === null) return null;
  const date = new Date(parts.year, parts.month - 1, parts.day, 23, 59, 59);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** 'YYYY-MM-DD' + 'HH:mm' → ISO datetime, device-local. */
export function composeLocalDateTimeIso(dateOnly: string, hhmm: string): string | null {
  const parts = parseDateOnly(dateOnly);
  const tm = HHMM.exec(hhmm);
  if (parts === null || tm === null) return null;
  const date = new Date(parts.year, parts.month - 1, parts.day, Number(tm[1]), Number(tm[2]));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Strict 'YYYY-MM-DD' parse: the regex gates the shape, then a Date
 * round-trip rejects impossible dates (month 13, Feb 30, … — the JS
 * Date constructor silently rolls those over, which must never happen).
 */
function parseDateOnly(dateOnly: string): { year: number; month: number; day: number } | null {
  const match = DATE_ONLY.exec(dateOnly);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return { year, month, day };
}

function validEstMinutes(estMinutes: number | null): boolean {
  return (
    typeof estMinutes === 'number' &&
    Number.isFinite(estMinutes) &&
    Number.isInteger(estMinutes) &&
    estMinutes >= 1 &&
    estMinutes <= 1440
  );
}

/**
 * Validate a finished form BEFORE the submit call (design.md §4.3: the
 * wizard intercepts required fields first, with Chinese copy). Returns the
 * first problem, or null when the form is submittable.
 */
export function validateForm(form: FormKind, fields: FormFields): string | null {
  if (fields.title.trim() === '') return '标题不能为空';
  if (fields.expectedBy !== '' && DATE_ONLY.exec(fields.expectedBy) === null) {
    return '日期格式应为 YYYY-MM-DD';
  }
  if (fields.deadline !== '' && DATE_ONLY.exec(fields.deadline) === null) {
    return '日期格式应为 YYYY-MM-DD';
  }
  switch (form) {
    case 'reference':
      return fields.url.trim() === '' ? '请填写链接（URL）' : null;
    case 'someday':
      return null;
    case 'trash':
      return null;
    case 'project':
      if (fields.projectTitle.trim() === '') return '项目名不能为空';
      if (fields.projectOutcome.trim() === '') return '请填写项目结果（"完成"是什么样）';
      return validEstMinutes(fields.estMinutes) ? null : '请选择或填写预估时长（分钟）';
    case 'waiting':
      return fields.waitingOn.trim() === '' ? '请填写在等谁 / 什么' : null;
    case 'calendar':
      if (composeLocalDateTimeIso(fields.startsAtDate, fields.startsAtTime) === null) {
        return '请选择开始日期和时间';
      }
      return validEstMinutes(fields.estMinutes) ? null : '请选择或填写预估时长（分钟）';
    case 'action':
      return validEstMinutes(fields.estMinutes) ? null : '请选择或填写预估时长（分钟）';
  }
}

// ---------------------------------------------------------------------------
// Submission builders (form → core answers + db target)
// ---------------------------------------------------------------------------

export type Submission =
  | { mode: 'clarify'; answers: ClarifyAnswers; target: ClarifyTarget }
  | { mode: 'reclarify'; answers: ReclarifyAnswers; target: ClarifyTarget };

const NON_ACTIONABLE_ANSWERS = { multipleSteps: false, twoMinutes: false, myResponsibility: true, fixedTime: false };

/**
 * The Q3b-YES "completed on the spot" submission (do-now path): no form is
 * involved — the screen submits it immediately and dispatches `done` with
 * the result.
 */
export function buildDoNowSubmission(mode: WizardMode): Submission {
  const target: ClarifyTarget = {};
  if (mode === 'clarify') {
    return {
      mode,
      answers: {
        actionable: true,
        multipleSteps: false,
        twoMinutes: true,
        completedOnTheSpot: true,
        myResponsibility: true,
        fixedTime: false,
      },
      target,
    };
  }
  return {
    mode,
    answers: {
      multipleSteps: false,
      twoMinutes: true,
      completedOnTheSpot: true,
      myResponsibility: true,
      fixedTime: false,
    },
    target,
  };
}

/**
 * Build the submission for a validated form state. `validateForm` must have
 * returned null first — this function assumes the required fields are set.
 */
export function buildFormSubmission(mode: WizardMode, form: FormKind, fields: FormFields, twoMinute: boolean): Submission {
  const optional = (text: string): string | undefined => (text.trim() === '' ? undefined : text.trim());

  switch (form) {
    case 'reference': {
      const target: ClarifyTarget = { title: fields.title.trim(), url: fields.url.trim(), note: optional(fields.note) };
      if (mode === 'clarify') {
        return { mode, answers: { actionable: false, nonActionableKind: 'reference', ...NON_ACTIONABLE_ANSWERS }, target };
      }
      throw new Error('unreachable: re-clarify re-enters at Q2 (no reference branch)');
    }
    case 'someday': {
      const target: ClarifyTarget = { title: fields.title.trim(), note: optional(fields.note) };
      if (mode === 'clarify') {
        return { mode, answers: { actionable: false, nonActionableKind: 'someday', ...NON_ACTIONABLE_ANSWERS }, target };
      }
      throw new Error('unreachable: re-clarify re-enters at Q2 (no someday branch)');
    }
    case 'trash': {
      if (mode === 'clarify') {
        return { mode, answers: { actionable: false, nonActionableKind: 'trash', ...NON_ACTIONABLE_ANSWERS }, target: {} };
      }
      throw new Error('unreachable: re-clarify re-enters at Q2 (no trash branch)');
    }
    case 'project': {
      const target: ClarifyTarget = {
        projectTitle: fields.projectTitle.trim(),
        projectValue: fields.projectValue,
        actionTitle: fields.actionTitle.trim(),
        estMinutes: fields.estMinutes as number,
      };
      const projectOutcome = fields.projectOutcome.trim();
      if (mode === 'clarify') {
        return {
          mode,
          answers: { actionable: true, multipleSteps: true, projectOutcome, twoMinutes: false, myResponsibility: true, fixedTime: false },
          target,
        };
      }
      return {
        mode,
        answers: { multipleSteps: true, projectOutcome, twoMinutes: false, myResponsibility: true, fixedTime: false },
        target,
      };
    }
    case 'waiting': {
      const target: ClarifyTarget = {
        title: fields.title.trim(),
        waitingOn: fields.waitingOn.trim(),
        expectedBy: fields.expectedBy !== '' ? (endOfLocalDayIso(fields.expectedBy) ?? undefined) : undefined,
      };
      if (mode === 'clarify') {
        return {
          mode,
          answers: { actionable: true, multipleSteps: false, twoMinutes: false, myResponsibility: false, fixedTime: false },
          target,
        };
      }
      return {
        mode,
        answers: { multipleSteps: false, twoMinutes: false, myResponsibility: false, fixedTime: false },
        target,
      };
    }
    case 'calendar': {
      const startsAt = composeLocalDateTimeIso(fields.startsAtDate, fields.startsAtTime);
      if (startsAt === null) throw new Error('calendar form submitted without a valid startsAt');
      const target: ClarifyTarget = {
        title: fields.title.trim(),
        startsAt,
        estMinutes: fields.estMinutes as number,
        value: fields.value,
        deadline: fields.deadline !== '' ? (endOfLocalDayIso(fields.deadline) ?? undefined) : undefined,
      };
      if (mode === 'clarify') {
        return {
          mode,
          answers: { actionable: true, multipleSteps: false, twoMinutes: false, myResponsibility: true, fixedTime: true },
          target,
        };
      }
      return {
        mode,
        answers: { multipleSteps: false, twoMinutes: false, myResponsibility: true, fixedTime: true },
        target,
      };
    }
    case 'action': {
      const target: ClarifyTarget = {
        title: fields.actionTitle.trim(),
        estMinutes: fields.estMinutes as number,
        // Two-minute path: value is the fixed spec default — omit it and
        // let the db layer apply the default (3) / keep the re-clarify old
        // value. Clarified path: the user-set value.
        ...(twoMinute ? {} : { value: fields.value }),
        deadline: fields.deadline !== '' ? (endOfLocalDayIso(fields.deadline) ?? undefined) : undefined,
      };
      if (mode === 'clarify') {
        return {
          mode,
          answers: {
            actionable: true,
            multipleSteps: false,
            twoMinutes: twoMinute,
            ...(twoMinute ? { completedOnTheSpot: false } : {}),
            myResponsibility: true,
            fixedTime: false,
          },
          target,
        };
      }
      return {
        mode,
        answers: {
          multipleSteps: false,
          twoMinutes: twoMinute,
          ...(twoMinute ? { completedOnTheSpot: false } : {}),
          myResponsibility: true,
          fixedTime: false,
        },
        target,
      };
    }
  }
}

/** Human-facing (Chinese) outcome summary for the wizard's done step. */
export function outcomeLabel(outcome: ClarifyOutcome): string {
  switch (outcome.kind) {
    case 'reference':
      return '资料';
    case 'someday':
      return '有空再说';
    case 'trash':
      return '已删除（可进回收站找回）';
    case 'do-now-completed':
      return '当场完成';
    case 'project':
      return '项目 + 首个行动';
    case 'waiting-for':
      return '等待他人';
    case 'calendar-action':
      return '固定时间行动';
    case 'next-action':
      return '下一步行动';
  }
}
