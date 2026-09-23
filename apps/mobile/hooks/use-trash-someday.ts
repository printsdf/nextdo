/**
 * Someday-maybe trash mutation hook (weekly review's someday decisions,
 * design.md §4.5): delegates to the packages/db `trashSomedayMaybeItem`
 * soft delete (deleted_at set — the row stays local, the server upload
 * keeps the audit trail). `now` from the single app clock (Rule 4).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { trashSomedayMaybeItem, wrapDb } from '@nextdo/db';
import { logger } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface UseTrashSomedayResult {
  trash: (id: string) => Promise<boolean>;
  error: string | null;
}

export function useTrashSomeday(): UseTrashSomedayResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const trash = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await trashSomedayMaybeItem(db, { id, now });
        setError(null);
        return true;
      } catch (err: unknown) {
        logger.error('someday trash failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [db, now],
  );

  return { trash, error };
}
