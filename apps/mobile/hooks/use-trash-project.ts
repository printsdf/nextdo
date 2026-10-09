/**
 * Project trash mutation hook:
 * a thin delegation to the packages/db `trashProject` soft delete — Trash
 * sets `deleted_at` (domain-model.md). `now` from the single app clock
 * (hook-guidelines Rule 4).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { trashProject, wrapDb } from '@nextdo/db';
import { logger } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface UseTrashProjectResult {
  /** Resolves true when the local write committed (false on error). */
  trash: (id: string) => Promise<boolean>;
  error: string | null;
}

export function useTrashProject(): UseTrashProjectResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const trash = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await trashProject(db, { id, now });
        setError(null);
        return true;
      } catch (err: unknown) {
        logger.error('project trash failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [db, now],
  );

  return { trash, error };
}
