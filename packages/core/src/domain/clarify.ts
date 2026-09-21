/**
 * The Clarify decision table (spec: domain-model.md §Clarify — complete,
 * no implicit branches).
 *
 * Pure classification: given the user's answers, which target row(s)
 * must the (single) DB transaction create? The DB layer applies the
 * outcome; the target row carries `sourceInboxId` for traceability.
 */
import { ValidationNextdoError } from '../lib/errors';

/** Default value for the two-minute "DO NOW → became a NextAction" path. */
export const NEXT_ACTION_DEFAULT_VALUE = 3 as const;

export interface ClarifyAnswers {
  /** Q1: 可以行动吗？ */
  actionable: boolean;
  /** Q1 follow-up, required when `actionable === false`. */
  nonActionableKind?: 'reference' | 'someday' | 'trash';
  /** Q2, actionable only: 需要多个步骤吗？ */
  multipleSteps: boolean;
  /** Required when `multipleSteps`: the project outcome (what "done" means). */
  projectOutcome?: string;
  /** Q3, single-step only: 约 2 分钟内能完成吗？ */
  twoMinutes: boolean;
  /** Q3 follow-up: completed on the spot? */
  completedOnTheSpot?: boolean;
  /** Q4, not two-minute only: 应该由我完成吗？ */
  myResponsibility: boolean;
  /** Q5, my responsibility only: 必须在特定日期/时间执行吗？ */
  fixedTime: boolean;
}

export type ClarifyOutcome =
  | { kind: 'reference' }
  | { kind: 'someday' }
  | { kind: 'trash' }
  /**
   * DO NOW, completed on the spot: CompletionRecord(actionKind="do_now",
   * actionId = sourceInboxId) + trash the InboxItem. No action entity.
   */
  | { kind: 'do-now-completed' }
  /**
   * Two-minute, not completed on the spot → NextAction with
   * value = NEXT_ACTION_DEFAULT_VALUE; questions 4–5 do not apply.
   */
  | { kind: 'next-action'; source: 'two-minute' }
  | { kind: 'project' }
  | { kind: 'waiting-for' }
  | { kind: 'calendar-action' }
  | { kind: 'next-action'; source: 'clarified' };

/**
 * Walk the decision table. Throws ValidationNextdoError when the answers
 * are incomplete for the branch taken, or when a project has no outcome
 * (code "project.needs-outcome").
 */
export function classifyInboxItem(answers: ClarifyAnswers): ClarifyOutcome {
  if (!answers.actionable) {
    switch (answers.nonActionableKind) {
      case 'reference':
        return { kind: 'reference' };
      case 'someday':
        return { kind: 'someday' };
      case 'trash':
        return { kind: 'trash' };
      default:
        throw new ValidationNextdoError(
          'clarify.incomplete',
          'Non-actionable items require nonActionableKind: reference | someday | trash',
        );
    }
  }

  if (answers.multipleSteps) {
    if (answers.projectOutcome === undefined || answers.projectOutcome.trim() === '') {
      throw new ValidationNextdoError(
        'project.needs-outcome',
        'A project requires an outcome (what "done" means)',
      );
    }
    // Project + its first NextAction are created ATOMICALLY by the caller.
    return { kind: 'project' };
  }

  if (answers.twoMinutes) {
    if (answers.completedOnTheSpot) {
      return { kind: 'do-now-completed' };
    }
    return { kind: 'next-action', source: 'two-minute' };
  }

  if (!answers.myResponsibility) {
    return { kind: 'waiting-for' };
  }

  return answers.fixedTime ? { kind: 'calendar-action' } : { kind: 'next-action', source: 'clarified' };
}
