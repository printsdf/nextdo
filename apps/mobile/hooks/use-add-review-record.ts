/**
 * Review-record append hook (design.md §4.5): assembles the full
 * append-only ReviewRecord entity (ulid id + `at` from the single app
 * clock) and delegates to the packages/db `addReviewRecord` (core's
 * `assertReviewRecord` validates the snapshot/answers shapes in the db
 * layer). The review screens call this LAST — after every decision
 * transaction has landed (变更先、记录后; a failure before this point
 * means no record, no "recorded but not executed" phantom).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { addReviewRecord, wrapDb } from '@nextdo/db';
import {
  logger,
  toIso,
  ulid,
  type DailyReviewAnswers,
  type DailyReviewSnapshot,
  type WeeklyReviewAnswers,
  type WeeklyReviewSnapshot,
} from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export type ReviewRecordInput =
  | { kind: 'daily'; snapshot: DailyReviewSnapshot; answers: DailyReviewAnswers }
  | { kind: 'weekly'; snapshot: WeeklyReviewSnapshot; answers: WeeklyReviewAnswers };

export interface UseAddReviewRecordResult {
  add: (input: ReviewRecordInput) => Promise<boolean>;
  error: string | null;
}

export function useAddReviewRecord(): UseAddReviewRecordResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(
    async (input: ReviewRecordInput): Promise<boolean> => {
      const nowIso = toIso(now);
      const record = {
        id: ulid(now),
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        at: nowIso,
        ...input,
      };
      try {
        await addReviewRecord(db, record);
        setError(null);
        return true;
      } catch (err: unknown) {
        logger.error('review record append failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [db, now],
  );

  return { add, error };
}
