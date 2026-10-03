/**
 * Habit trash mutation (the habits screen's per-row 删除, task 10-02):
 * a thin delegation to the packages/db `trashHabit` soft delete — Trash
 * is `deleted_at` set (domain-model.md), so the habit's HabitDay rows
 * stay but the pool ignores them. `now` from the single app clock
 * (hook-guidelines Rule 4).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { trashHabit, wrapDb } from '@nextdo/db';
import { logger } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface UseTrashHabitResult {
  /** Resolves true when the local write committed (false on error). */
  trash: (id: string) => Promise<boolean>;
  error: string | null;
}

export function useTrashHabit(): UseTrashHabitResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const trash = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await trashHabit(db, { id, now });
        setError(null);
        return true;
      } catch (err: unknown) {
        logger.error('habit trash failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [db, now],
  );

  return { trash, error };
}