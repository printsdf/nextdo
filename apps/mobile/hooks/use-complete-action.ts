/**
 * Complete mutation hook (Now screen, project detail, habit one-tap, review
 * flows): delegates to the packages/db `completeAction` canonical
 * transaction (status + CompletionRecord + Reminder cancel + habit-day
 * advance — one local transaction). `now` from the single app clock
 * (hook-guidelines Rule 4). Resolves `true` on success / `false` on
 * failure (the typed `error` state is set either way) — multi-step flows
 * (the review submit) sequence on the boolean so a failure STOPS the
 * sequence instead of silently continuing.
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { completeAction, wrapDb, type ActionKind } from '@nextdo/db';
import { logger } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface CompleteArgs {
  actionKind: ActionKind;
  actionId: string;
}

export interface UseCompleteActionResult {
  complete: (args: CompleteArgs) => Promise<boolean>;
  error: string | null;
}

export function useCompleteAction(): UseCompleteActionResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const complete = useCallback(
    async (args: CompleteArgs): Promise<boolean> => {
      try {
        await completeAction(db, { ...args, now });
        setError(null);
        return true;
      } catch (err: unknown) {
        logger.error('complete action failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [db, now],
  );

  return { complete, error };
}
