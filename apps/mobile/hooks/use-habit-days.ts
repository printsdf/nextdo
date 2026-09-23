/**
 * Today's habit days (Now screen's habit strip, design.md §4.1.6 — PRD
 * decision 3: read-only progress + one-tap complete).
 *
 * `listHabitDays({ localDate })` with the device-local YYYYMMDD key (core
 * `localDateKey`). Query-style by design (no habit watch query in the
 * frozen packages/db surface); re-read after each one-tap complete.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { completeAction, listHabits, listHabitDays, wrapDb } from '@nextdo/db';
import { localDateKey, logger, type HabitDay } from '@nextdo/core';

export interface UseHabitDaysResult {
  /** null until the first read settles. */
  days: HabitDay[] | null;
  /** habitId → title (the chip label — a HabitDay row only carries the id). */
  habitTitles: Record<string, string>;
  error: string | null;
  /** One-tap complete for a today open habit day (canonical complete transaction). */
  complete: (dayId: string) => Promise<void>;
}

export function useHabitDays(now: Date): UseHabitDaysResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const localDate = localDateKey(now);
  const [days, setDays] = useState<HabitDay[] | null>(null);
  const [habitTitles, setHabitTitles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listHabitDays(db, { localDate })
      .then((result) => {
        if (!cancelled) {
          setDays(result);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error('habit days query failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [db, localDate, reloadKey]);

  // Titles: one read per mount (non-fatal — the chip falls back to "习惯").
  useEffect(() => {
    let cancelled = false;
    listHabits(db)
      .then((habits) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const habit of habits) map[habit.id] = habit.title;
        setHabitTitles(map);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.warn('habits query failed', err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
    };
  }, [db]);

  const complete = useCallback(
    async (dayId: string) => {
      try {
        // The habit-day row IS the action (ACTION_TABLES: habit → habit_days).
        await completeAction(db, { actionKind: 'habit', actionId: dayId, now });
        setError(null);
        setReloadKey((key) => key + 1);
      } catch (err: unknown) {
        logger.error('habit day complete failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [db, now],
  );

  return { days, habitTitles, error, complete };
}
