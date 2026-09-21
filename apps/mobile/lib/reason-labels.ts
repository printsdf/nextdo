/**
 * Human-facing labels for engine reason codes (Now screen "Why this?").
 *
 * The engine emits machine `Reason` objects (core `ReasonCode`); the
 * presentation layer turns them into short, readable phrases. This is pure
 * presentation — no engine logic (spec: component-guidelines). Labels are
 * keyed by the exact `ReasonCode` union so a missing code is a type error.
 */
import type { ReasonCode } from '@nextdo/core';

export const REASON_LABELS: Record<ReasonCode, string> = {
  // score reasons (weighted)
  'deadline-urgency': 'Deadline is close',
  'goal-value': 'High value',
  'project-importance': 'Backs an important project',
  'time-fit': 'Fits the time you have',
  'waiting-time': 'Has been waiting a while',
  'habit-commitment': 'Habit streak to keep',
  'health-protection': 'Protects your health',
  // eligibility reasons (why it can run right now)
  'context-match': 'Matches your context',
  'window-open': 'Within its time window',
  'time-fits': 'Fits the time you have',
  'dependency-clear': 'Its dependency is done',
  'calendar-preempt': 'Preempts the next hour',
};

/** The `ReasonCode` union re-exported for the screens. */
export type { ReasonCode };
