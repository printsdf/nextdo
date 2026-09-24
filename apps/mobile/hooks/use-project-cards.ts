/**
 * Project-cards data hook (design §4.2): the watched
 * `projectCardsWatchQuery` — every non-deleted project plus the derived
 * card stats (open/completed counts, earliest open deadline, latest
 * progress, current next action). The counts re-derive themselves on
 * action changes (the watch tracks `projects` + `next_actions` +
 * `completion_records`).
 *
 * The time-sensitive stall flag deliberately stays in the UI layer: the
 * watch mapper does not tick with the app clock, so `isProjectStalled`
 * combines the watch row with `now` from the single app clock
 * (hook-guidelines Rule 4 precedent: `shouldOfferReclarify` in use-now.ts).
 */
import { useMemo } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { isStalled, projectCardsWatchQuery, wrapDb, type ProjectCard } from '@nextdo/db';

export interface UseProjectCardsResult {
  data: ProjectCard[];
  error: string | null;
}

export function useProjectCards(): UseProjectCardsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const { data, error } = useQuery(projectCardsWatchQuery(db));
  // `@powersync/react` types `error` as `Error | undefined` but delivers
  // `null` at runtime (watch state) — a truthy check, not `=== undefined`.
  return { data, error: error ? String(error.message) : null };
}

/**
 * An ACTIVE project is stalled when it is quiet for ≥ `STALL_DAYS` days —
 * the weekly review's own definition (`isStalled` reused, logic untouched).
 * Derived here, against the app clock, not in the watch mapper.
 */
export function isProjectStalled(card: ProjectCard, now: Date): boolean {
  return card.status === 'active' && isStalled(card.lastProgressAt, card.createdAt, now);
}
