/**
 * Value ranking (Proposal §6.2) — fixed v1 weights, exact formula:
 * score = Σ W[c] × signal(c), each signal in [0, 1].
 */
import { hhmmToMinutes, hoursBetween, minutesOfDay, parseHhmm, parseIso } from '../lib/time';
import { W } from './weights';
import type { CandidateAction, EngineInput, Reason, ScoreCode } from './types';

export const SCORE_CODES: readonly ScoreCode[] = [
  'deadline-urgency',
  'goal-value',
  'project-importance',
  'time-fit',
  'waiting-time',
  'habit-commitment',
  'health-protection',
];

export interface CandidateScore {
  actionId: string;
  score: number;
  /** Every signal value in [0, 1] — for tests and explainability. */
  signals: Record<ScoreCode, number>;
  /** Score reasons (type "score") for every code with signal > 0. */
  reasons: Reason[];
}

/** Waiting-time cap: 14 days. */
const WAITING_TIME_CAP_DAYS = 14;

export function scoreCandidate(candidate: CandidateAction, input: EngineInput): CandidateScore {
  const now = input.now;
  const signals: Record<ScoreCode, number> = {
    'deadline-urgency': 0,
    'goal-value': 0,
    'project-importance': 0,
    'time-fit': 0,
    'waiting-time': 0,
    'habit-commitment': 0,
    'health-protection': 0,
  };

  // Band edges inclusive on the upper bound: "3 天后" (h = 72 h) → 0.7.
  if (candidate.deadline !== undefined) {
    const h = hoursBetween(now, parseIso(candidate.deadline));
    if (h <= 0) signals['deadline-urgency'] = 1.0;
    else if (h <= 24) signals['deadline-urgency'] = 0.9;
    else if (h <= 72) signals['deadline-urgency'] = 0.7;
    else if (h <= 168) signals['deadline-urgency'] = 0.4;
    // h > 168 → 0
  }

  signals['goal-value'] = candidate.value / 5;

  if (candidate.projectId !== undefined) {
    const project = input.projects.find((p) => p.id === candidate.projectId);
    if (project !== undefined && project.status === 'active') {
      signals['project-importance'] = project.value / 5;
    }
  }

  signals['time-fit'] = Math.max(0, 1 - candidate.estMinutes / input.context.availableMinutes);

  const createdMs = parseIso(candidate.createdAt).getTime();
  const snoozedMs =
    candidate.lastSnoozedAt !== undefined ? parseIso(candidate.lastSnoozedAt).getTime() : null;
  const waitingMs = Math.max(0, now.getTime() - Math.max(createdMs, snoozedMs ?? 0));
  signals['waiting-time'] =
    Math.min(waitingMs / 86_400_000, WAITING_TIME_CAP_DAYS) / WAITING_TIME_CAP_DAYS;

  if (candidate.kind === 'habit') {
    signals['habit-commitment'] = 0.5;
    if (candidate.windowStart !== undefined && candidate.windowEnd !== undefined) {
      const startMin = hhmmToMinutes(parseHhmm(candidate.windowStart));
      const endMin = hhmmToMinutes(parseHhmm(candidate.windowEnd));
      const length = endMin - startMin;
      // +0.5 when now ≥ windowEnd − ⅓ × window length
      if (length > 0 && minutesOfDay(now) >= endMin - length / 3) {
        signals['habit-commitment'] = 1.0;
      }
    }
  }

  // A normal weighted boost, not a top-slot guarantee.
  if (candidate.category === 'health') signals['health-protection'] = 1;

  let score = 0;
  for (const code of SCORE_CODES) {
    score += W[code] * signals[code];
  }

  const reasons: Reason[] = SCORE_CODES.filter((code) => signals[code] > 0).map((code) => ({
    type: 'score',
    code,
  }));

  return { actionId: candidate.id, score, signals, reasons };
}
