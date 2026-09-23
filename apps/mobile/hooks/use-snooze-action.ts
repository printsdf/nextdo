/**
 * Snooze mutation hook (Now screen's [稍后] sheet, project detail rows):
 * delegates to the packages/db `snoozeAction` transaction (snoozedUntil +
 * reminder row + skip-counter reset — all inside the db transaction).
 * `now` from the single app clock (hook-guidelines Rule 4). Resolves
 * `true` on success / `false` on failure (the review submit sequences on
 * the boolean so a failure stops the sequence).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { snoozeAction, wrapDb, type ActionKind } from '@nextdo/db';
import { logger } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface SnoozeArgs {
  actionKind: ActionKind;
  actionId: string;
  /** The snooze target (device-local Date from lib/snooze-options). */
  snoozedUntil: Date;
}

export interface UseSnoozeActionResult {
  snooze: (args: SnoozeArgs) => Promise<boolean>;
  error: string | null;
}

export function useSnoozeAction(): UseSnoozeActionResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const snooze = useCallback(
    async (args: SnoozeArgs): Promise<boolean> => {
      try {
        await snoozeAction(db, { ...args, now });
        setError(null);
        return true;
      } catch (err: unknown) {
        logger.error('snooze action failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [db, now],
  );

  return { snooze, error };
}
