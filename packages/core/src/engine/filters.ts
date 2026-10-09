/**
 * Hard filter (Proposal §6.1) — fixed rule order, every exclusion
 * recorded. Candidates arrive per the pool contract (already open and
 * non-deleted); done/deleted filtering is the pool's job, not the
 * engine's.
 */
import { isWithinDayWindow, parseIso } from '../lib/time';
import type { CalendarCandidate, CandidateAction, EngineInput, FilterRuleId } from './types';

export interface FilterResult {
  /** Hard-filter survivors (non-preempted), input order. */
  ranked: CandidateAction[];
  /** Calendar preemption (startsAt within the next 60 minutes), input order. */
  preempted: CandidateAction[];
  /** Every exclusion with the rule that caused it. */
  filtered: { actionId: string; rule: FilterRuleId }[];
}

const PREEMPTION_WINDOW_MS = 60 * 60_000;

export function hardFilter(input: EngineInput): FilterResult {
  const result: FilterResult = { ranked: [], preempted: [], filtered: [] };
  for (const action of input.actions) {
    const rule = exclusionRule(action, input);
    if (rule !== null) {
      result.filtered.push({ actionId: action.id, rule });
      continue;
    }
    if (action.kind === 'calendar' && isPreempted(action, input.now)) {
      result.preempted.push(action);
    } else {
      result.ranked.push(action);
    }
  }
  return result;
}

/**
 * Fixed order: snoozed → context-mismatch → too-long → window-mismatch →
 * dependency → calendar-conflict. First failing rule wins.
 */
function exclusionRule(action: CandidateAction, input: EngineInput): FilterRuleId | null {
  const now = input.now;

  if (action.snoozedUntil !== undefined && parseIso(action.snoozedUntil).getTime() > now.getTime()) {
    return 'snoozed';
  }

  // An action with empty contextIds matches anywhere. An empty user context matches all actions.
  if (
    input.context.contextIds.length > 0 &&
    action.contextIds.length > 0 &&
    !action.contextIds.some((id) => input.context.contextIds.includes(id))
  ) {
    return 'context-mismatch';
  }

  if (action.estMinutes > input.context.availableMinutes) return 'too-long';

  // Device-local: weekday mask first, then HH:mm range.
  if (!isWithinDayWindow(now, action.windowStart, action.windowEnd, action.windowDays)) {
    return 'window-mismatch';
  }

  if (action.dependencyDone === false) return 'dependency';

  if (action.kind === 'calendar' && overlapsForeignBlock(action, input)) {
    return 'calendar-conflict';
  }

  return null;
}

/** A CalendarCandidate with startsAt within the next 60 minutes preempts. */
function isPreempted(action: CalendarCandidate, now: Date): boolean {
  const delta = parseIso(action.startsAt).getTime() - now.getTime();
  return delta >= 0 && delta <= PREEMPTION_WINDOW_MS;
}

/**
 * Overlap with a CalendarBlock whose sourceActionId !== candidate.id.
 * A candidate never conflicts with its own block; non-action blocks have
 * no sourceActionId.
 */
function overlapsForeignBlock(action: CalendarCandidate, input: EngineInput): boolean {
  const start = parseIso(action.startsAt).getTime();
  const end = start + action.estMinutes * 60_000;
  for (const block of input.calendar) {
    if (block.sourceActionId === action.id) continue;
    const blockStart = parseIso(block.start).getTime();
    const blockEnd = parseIso(block.end).getTime();
    if (blockStart < end && blockEnd > start) return true;
  }
  return false;
}
