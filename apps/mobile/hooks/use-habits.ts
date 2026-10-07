/**
 * Habits + challenge progress (the habits screen, design.md §4).
 *
 * Query-style, like `useProjectActions` / `useHabitDays`: the frozen
 * `packages/db` surface has no habit watch query, so this reads
 * `listHabits()` + `listHabitDays()` once per mount (and on every
 * `reload()` — the screen calls it after create / trash) and joins them
 * client-side into the ONE view the screen renders.
 *
 * The challenge day (`N/21`) is NOT re-derived here: `habitCycleDay` is
 * re-exported from `packages/db` (design.md §2) precisely so the app has
 * a single source of truth for the cycle boundary.
 *
 * `now` comes from the single app clock (hook-guidelines Rule 4).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { habitCycleDay, listHabits, listHabitDays, wrapDb } from '@nextdo/db';
import { localDateKey, logger, type Habit } from '@nextdo/core';

export interface HabitWithProgress {
  habit: Habit;
  /** 1-based day inside the challenge cycle; null when today is outside it. */
  cycleDay: number | null;
  /** HabitDays done INSIDE the current cycle. */
  doneCount: number;
}

export interface UseHabitsResult {
  /** null until the first read settles. */
  data: HabitWithProgress[] | null;
  error: string | null;
  /** Re-read after a mutation that changes the habit set. */
  reload: () => void;
}

export function useHabits(now: Date): UseHabitsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const [data, setData] = useState<HabitWithProgress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const localDate = localDateKey(now);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listHabits(db), listHabitDays(db)])
      .then(([habits, days]) => {
        if (cancelled) return;
        const daysByHabit = new Map<string, typeof days>();
        for (const day of days) {
          const bucket = daysByHabit.get(day.habitId);
          if (bucket === undefined) daysByHabit.set(day.habitId, [day]);
          else bucket.push(day);
        }
        const rows: HabitWithProgress[] = [];
        for (const habit of habits) {
          if (habit.status !== 'active') continue;
          const cycleDay = habitCycleDay(habit.startedAt, habit.cycleDays, localDate);
          const doneCount = (daysByHabit.get(habit.id) ?? []).filter(
            (day) =>
              day.status === 'done' &&
              habitCycleDay(habit.startedAt, habit.cycleDays, day.localDate) !== null,
          ).length;
          rows.push({ habit, cycleDay, doneCount });
        }
        setData(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error('habits query failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [db, localDate, reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return { data, error, reload };
}