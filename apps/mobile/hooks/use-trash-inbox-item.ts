/**
 * Inline-trash mutation hook (the Inbox row's trash button, design.md
 * §4.2): delegates to the packages/db `trashInboxItem` soft delete.
 * `now` comes from the single app clock (hook-guidelines Rule 4).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { trashInboxItem, wrapDb } from '@nextdo/db';
import { logger } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface UseTrashInboxItemResult {
  trash: (id: string) => Promise<void>;
  error: string | null;
}

export function useTrashInboxItem(): UseTrashInboxItemResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const trash = useCallback(
    async (id: string) => {
      try {
        await trashInboxItem(db, { id, now });
        setError(null);
      } catch (err: unknown) {
        logger.error('inbox trash failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [db, now],
  );

  return { trash, error };
}
