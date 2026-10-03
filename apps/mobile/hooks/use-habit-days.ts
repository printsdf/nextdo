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
  /**
   * Re-read the local rows. The Now tab stays MOUNTED when the habits
   * screen is pushed on top of it, so a habit created there would not
   * appear here on return — the screen calls this on focus
   * (`useFocusEffect`, task 10-02 / design.md §3).
   */
  reload: () => void;
}

export function useHabitDays(now: Date): UseHabitDaysResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const localDate = localDateKey(now);
  const [days, setDays] = useState<HabitDay[] | null>(null);
  const [habitTitles, setHabitTitles] = useState<Record<string, string>>({});
  /**
   * Ids of the LIVE, ACTIVE habits — the same gate `queryEnginePool`
   * applies to a HabitDay (pool.ts skips a day whose parent habit is
   * soft-deleted or not `active`). `null` while still unknown (first
   * read, or the habits read failed): the strip then shows every day
   * rather than hiding data because a SECONDARY read failed.
   *
   * It exists because `trashHabit` is a SOFT delete — the habit's day
   * rows deliberately survive it (PRD F5) and `listHabitDays` cannot see
   * the parent, so without this gate a deleted habit would keep showing
   * a completable chip on the Now screen forever.
   */
  const [liveHabitIds, setLiveHabitIds] = useState<Set<string> | null>(null);
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

  // Titles + the liveness gate: one read per mount / reload (non-fatal —
  // the chip falls back to "习惯"). Re-reads with the days so a habit
  // created on the habits screen shows its own name when the Now tab
  // regains focus, and so a habit deleted there leaves the strip.
  useEffect(() => {
    let cancelled = false;
    listHabits(db)
      .then((habits) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        const live = new Set<string>();
        for (const habit of habits) {
          if (habit.status !== 'active') continue;
          map[habit.id] = habit.title;
          live.add(habit.id);
        }
        setHabitTitles(map);
        setLiveHabitIds(live);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.warn('habits query failed', err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
    };
  }, [db, reloadKey]);

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

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  // Drop the days of habits that are no longer live/active (derived in
  // render, never stored twice — hook-guidelines Rule 3). `listHabits`
  // already excludes soft-deleted rows, and `trashHabit` is a SOFT
  // delete, so this is what keeps a deleted habit's surviving day rows
  // off the strip. `liveHabitIds === null` (first read, or the habits
  // read failed) → show everything: the liveness read is SECONDARY, it
  // must never hide the days themselves.
  const visibleDays = useMemo(() => {
    if (days === null || liveHabitIds === null) return days;
    return days.filter((day) => liveHabitIds.has(day.habitId));
  }, [days, liveHabitIds]);

  return { days: visibleDays, habitTitles, error, complete, reload };
}
