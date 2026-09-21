/**
 * Fixed v1 ranking weights (Proposal §6.2). User-tunable later via the
 * settings table; the constants live here so the formula stays auditable.
 */
import type { ScoreCode } from './types';

export const W: Record<ScoreCode, number> = {
  'deadline-urgency': 1.0,
  'goal-value': 0.8,
  'project-importance': 0.6,
  'time-fit': 0.2,
  'waiting-time': 0.2,
  'habit-commitment': 0.5,
  'health-protection': 0.4,
};

/**
 * Eligible actions with `consecutiveSkips >= 3` surface in
 * `needsReclarify`. The Now screen shows the §6.4 prompt with the actual
 * count; the proposal's "4 次" is illustrative, not a spec.
 */
export const RECLARIFY_THRESHOLD = 3;
