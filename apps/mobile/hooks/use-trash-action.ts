/**
 * Trash mutation hook (row deletes on the Now "稍后" list, project detail):
 * delegates to the packages/db `trashAction` soft delete (all action kinds
 * via ACTION_TABLES). `now` from the single app clock (hook-guidelines Rule 4).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { trashAction, wrapDb, type ActionKind } from '@nextdo/db';
import { logger } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface TrashArgs {
  actionKind: ActionKind;
  actionId: string;
}

export interface UseTrashActionResult {
  trash: (args: TrashArgs) => Promise<void>;
  error: string | null;
}

export function useTrashAction(): UseTrashActionResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const trash = useCallback(
    async (args: TrashArgs) => {
      try {
        await trashAction(db, { ...args, now });
        setError(null);
      } catch (err: unknown) {
        logger.error('trash action failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [db, now],
  );

  return { trash, error };
}
