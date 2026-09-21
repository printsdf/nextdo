/**
 * Review data hook: the append-only review record trail (oldest first) via
 * the `packages/db` watched query. The scaffold screen is the entry point —
 * the daily/weekly review flows are later tasks.
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
  return { data, error: error === undefined ? null : String(error.message) };
}
