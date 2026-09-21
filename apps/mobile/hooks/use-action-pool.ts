/**
 * Engine pool data hook (design.md §4 — the Now screen's vertical slice):
 * reads the engine pool through `packages/db` and returns it ready to build
 * an `EngineInput` (the app fills `context` and `now`).
 *
 * Live update (hook-guidelines: the hook owns the subscription): the
 * `@powersync/react` watch subscription is an INVALIDATION TRIGGER only —
 * it selects one row from every table `queryEnginePool` reads, and the
 * rows themselves are unused. The pool is always recomputed by
 * `queryEnginePool` (the single home of the pool logic in packages/db),
 * re-firing on any pool-relevant table change and on the app clock tick.
 *
 * The pool result is a computed snapshot of the local DB, never a stored
 * copy (state-management Rule 1/3).
 */
import { useEffect, useMemo, useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { poolTriggerWatchQuery, queryEnginePool, wrapDb, type EnginePool } from '@nextdo/db';
import { logger } from '@nextdo/core';

export interface UseActionPoolResult {
  /** The pool snapshot, or null until the first computation settles. */
  data: EnginePool | null;
  error: string | null;
}

export function useActionPool(now: Date): UseActionPoolResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);

  const { data: trigger, error: watchError } = useQuery(poolTriggerWatchQuery(db));

  const [pool, setPool] = useState<EnginePool | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Async local read: recomputed when the trigger fires, the clock ticks,
  // or the db instance changes. (Data fetching, not a derived-value sync —
  // hook-guidelines Rule 3.)
  useEffect(() => {
    let cancelled = false;
    queryEnginePool(db, now)
      .then((result) => {
        if (!cancelled) {
          setPool(result);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error('engine pool query failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [db, now, trigger, watchError]);

  return {
    data: pool,
    error: error ?? (watchError !== undefined ? String(watchError.message) : null),
  };
}
