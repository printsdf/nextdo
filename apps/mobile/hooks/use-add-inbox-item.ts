/**
 * Capture mutation hook (the Inbox screen's low-friction input, design.md
 * §4.2): builds a raw InboxItem (title + capturedAt only — invariant 1: no
 * contexts/estimates/values at capture) and delegates to the packages/db
 * `addInboxItem` query. `now` comes from the single app clock (hook-
 * guidelines Rule 4).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { addInboxItem, wrapDb } from '@nextdo/db';
import { logger, toIso, ulid } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface UseAddInboxItemResult {
  add: (title: string) => Promise<void>;
  error: string | null;
}

export function useAddInboxItem(): UseAddInboxItemResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(
    async (title: string) => {
      const nowIso = toIso(now);
      const item = {
        id: ulid(now),
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        title: title.trim(),
        capturedAt: nowIso,
      };
      try {
        await addInboxItem(db, item);
        setError(null);
      } catch (err: unknown) {
        logger.error('inbox capture failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [db, now],
  );

  return { add, error };
}
