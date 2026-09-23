/**
 * Review data hook: the append-only review record trail (oldest first) via
 * the `packages/db` watched query. The Review tab lists these; the daily and
 * weekly review flows write to the same trail.
 */
import { useMemo } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { reviewRecordsWatchQuery, wrapDb } from '@nextdo/db';
import type { ReviewRecord } from '@nextdo/core';

export interface UseReviewRecordsResult {
  data: ReviewRecord[];
  error: string | null;
}

export function useReviewRecords(): UseReviewRecordsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const { data, error } = useQuery(reviewRecordsWatchQuery(db));
  // `@powersync/react` types `error` as `Error | undefined` but delivers
  // `null` at runtime (watch state) — a truthy check, not `=== undefined`.
  return { data, error: error ? String(error.message) : null };
}
