/**
 * Project-detail data hook (design.md §4.4): the project's OPEN next
 * actions — `packages/db` `listNextActions` with a CLIENT-SIDE projectId
 * filter (design.md §8: personal-scale data, the frozen db surface has no
 * projectId parameter). Query-style: re-read on mount and after each
 * mutation (the screen calls `reload`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { listNextActions, wrapDb } from '@nextdo/db';
import { logger, type NextAction } from '@nextdo/core';

export interface UseProjectActionsResult {
  /** null until the first read settles. */
  data: NextAction[] | null;
  error: string | null;
  /** Re-read after a mutation that changes the project's action set. */
  reload: () => void;
}

export function useProjectActions(projectId: string | null): UseProjectActionsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const [data, setData] = useState<NextAction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listNextActions(db)
      .then((actions) => {
        if (cancelled) return;
        setData(
          projectId === null
            ? []
            : actions.filter((action) => action.projectId === projectId && action.status === 'open'),
        );
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error('project actions query failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [db, projectId, reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return { data, error, reload };
}
