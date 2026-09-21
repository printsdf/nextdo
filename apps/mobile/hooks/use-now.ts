/**
 * The Now screen's recommendation (design.md §4): pool → engine → the one
 * action to show, with its score and "Why this?" reasons.
 *
 * Engine output is computed, never stored (state-management Rule 5):
 * `recommend()` re-runs (memoized on pool + clock) whenever the pool
 * changes or the app clock ticks — the Now screen always reflects the
 * current DB snapshot.
 */
import { useMemo } from 'react';
import {
  recommend,
  type CandidateAction,
  type EngineContext,
  type Reason,
} from '@nextdo/core';
import { useActionPool } from './use-action-pool';
import { useAppClock } from './use-app-clock';

/**
 * Scaffold engine context: the user is in no specific context (actions that
 * declare one are filtered out as context-mismatch — the context selection
 * UI is a later task) and can give a full hour (the worked example's slot;
 * the per-user available-time setting lands with the focus task).
 */
const SCAFFOLD_ENGINE_CONTEXT: EngineContext = {
  contextIds: [],
  availableMinutes: 60,
};

export interface NowRecommendation {
  /** The candidate the engine picked (kind, title, estimate, …). */
  action: CandidateAction;
  score: number;
  /** Score + eligibility reasons — the screen shows the top three. */
  reasons: Reason[];
}

export interface UseNowResult {
  /** null = nothing to recommend (empty pool, or every candidate filtered). */
  data: NowRecommendation | null;
  error: string | null;
}

export function useNow(): UseNowResult {
  const now = useAppClock();
  const poolQuery = useActionPool(now);

  const data = useMemo<NowRecommendation | null>(() => {
    const pool = poolQuery.data;
    if (pool === null) return null;
    const output = recommend({ ...pool, context: SCAFFOLD_ENGINE_CONTEXT, now });
    const recommended = output.recommended;
    if (recommended === null) return null;
    const action = pool.actions.find((candidate) => candidate.id === recommended.actionId);
    if (action === undefined) return null;
    return { action, score: recommended.score, reasons: recommended.reasons };
  }, [poolQuery.data, now]);

  return { data, error: poolQuery.error };
}
