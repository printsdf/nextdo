/**
 * Contexts data hook (Now screen's scene chips, design.md §4.1): the
 * non-deleted contexts + inline quick-create (`addContext`).
 *
 * Query-style by design (design.md §5 — no contexts watch query in the
 * frozen packages/db surface; personal-scale data, re-read on mount and
 * after each mutation).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { addContext, listContexts, wrapDb } from '@nextdo/db';
import { logger, toIso, ulid, type Context } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface UseContextsResult {
  /** null until the first read settles. */
  data: Context[] | null;
  error: string | null;
  /** Quick-create a context (the "＋" chip). */
  add: (name: string) => Promise<void>;
}

export function useContexts(): UseContextsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [data, setData] = useState<Context[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listContexts(db)
      .then((contexts) => {
        if (!cancelled) {
          setData(contexts);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error('contexts query failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [db, reloadKey]);

  const add = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (trimmed === '') return;
      const nowIso = toIso(now);
      const context: Context = {
        id: ulid(now),
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        name: trimmed,
      };
      try {
        await addContext(db, context);
        setError(null);
        setReloadKey((key) => key + 1);
      } catch (err: unknown) {
        logger.error('context create failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [db, now],
  );

  return { data, error, add };
}
