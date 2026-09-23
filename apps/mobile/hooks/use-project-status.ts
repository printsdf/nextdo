/**
 * Project-status mutation hook (weekly review's project decisions,
 * design.md §4.5): delegates to the packages/db `updateProject` full-row
 * update — a status change is asserted against core's
 * `PROJECT_TRANSITIONS` in the db layer (done/dropped terminal). `now`
 * from the single app clock (hook-guidelines Rule 4).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { updateProject, wrapDb } from '@nextdo/db';
import { logger, toIso, type Project, type ProjectStatus } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface ProjectStatusArgs {
  /** The full current row (the weekly data hook provides it). */
  project: Project;
  status: ProjectStatus;
}

export interface UseProjectStatusResult {
  set: (args: ProjectStatusArgs) => Promise<boolean>;
  error: string | null;
}

export function useProjectStatus(): UseProjectStatusResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const set = useCallback(
    async (args: ProjectStatusArgs): Promise<boolean> => {
      try {
        await updateProject(db, {
          ...args.project,
          status: args.status,
          updatedAt: toIso(now),
        });
        setError(null);
        return true;
      } catch (err: unknown) {
        logger.error('project status update failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [db, now],
  );

  return { set, error };
}
