/**
 * Project-detail habits data hook (design.md §1 / §6): habits bound to
 * the project, plus their challenge cycle progress and 21-day grid.
 *
 * Query-style (aligning with `useProjectActions` and `useHabits`): reads
 * `listHabits(db)` and `listHabitDays(db)` and joins them client-side.
 * Re-reads on mount and when `reload()` is called after a mutation
 * (create or complete).
 *
 * `cycleDay` is derived via `packages/db`'s exported `habitCycleDay`,
 * preserving the single source of truth for cycle bounds.
 *
 * `now` comes from the single app clock (hook-guidelines Rule 4).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { habitCycleDay, listHabits, listHabitDays, wrapDb } from '@nextdo/db';
import { localDateKey, logger, parseIso, type Habit, type HabitDay } from '@nextdo/core';

const DAY_MS = 86_400_000;

export type HabitCellStatus = 'done' | 'today' | 'missed' | 'future';

export interface HabitGridDay {
  /** 1-based day in the cycle (1 to cycleDays). */
  dayNumber: number;
  /** YYYYMMDD date key. */
  localDate: string;
  isToday: boolean;
  status: HabitCellStatus;
  /** The habit day row if one exists. */
  day?: HabitDay;
}

export interface ProjectHabitEntry {
  habit: Habit;
  /** 1-based day in the cycle; null if outside. */
  cycleDay: number | null;
  /** Completed HabitDays within the current cycle. */
  doneCount: number;
  /** Today's HabitDay row if open and actionable. */
  todayDay: HabitDay | null;
  /** The cycleDays cells for the current challenge cycle. */
  grid: HabitGridDay[];
}

export interface UseProjectHabitsResult {
  /** null until the first read settles. */
  data: ProjectHabitEntry[] | null;
  error: string | null;
  /** Re-read after habit create or complete. */
  reload: () => void;
}

export function useProjectHabits(projectId: string | null, now: Date): UseProjectHabitsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const [data, setData] = useState<ProjectHabitEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const todayKey = localDateKey(now);

  useEffect(() => {
    let cancelled = false;
    if (projectId === null) {
      setData([]);
      setError(null);
      return;
    }

    Promise.all([listHabits(db), listHabitDays(db)])
      .then(([habits, days]) => {
        if (cancelled) return;
        // Group days by habitId -> (localDate -> HabitDay)
        const daysByHabit = new Map<string, Map<string, HabitDay>>();
        for (const day of days) {
          let map = daysByHabit.get(day.habitId);
          if (map === undefined) {
            map = new Map<string, HabitDay>();
            daysByHabit.set(day.habitId, map);
          }
          map.set(day.localDate, day);
        }

        const entries: ProjectHabitEntry[] = [];
        const projectHabits = habits.filter(
          (habit) => habit.projectId === projectId && habit.status === 'active',
        );

        for (const habit of projectHabits) {
          const habitDaysMap = daysByHabit.get(habit.id) ?? new Map<string, HabitDay>();
          const cycleDays = habit.cycleDays ?? 21;
          const cycleDay = habitCycleDay(habit.startedAt, cycleDays, todayKey);
          const startedAtMs = parseIso(habit.startedAt).getTime();

          const grid: HabitGridDay[] = [];
          let todayDay: HabitDay | null = null;
          let doneCount = 0;

          for (let d = 0; d < cycleDays; d++) {
            const dayNumber = d + 1;
            const dayDate = new Date(startedAtMs + d * DAY_MS);
            const dateKey = localDateKey(dayDate);
            const isToday = dateKey === todayKey;
            const dayRow = habitDaysMap.get(dateKey);

            let status: HabitCellStatus;
            if (dayRow?.status === 'done') {
              status = 'done';
              doneCount++;
            } else if (isToday) {
              status = 'today';
              if (dayRow?.status === 'open') {
                todayDay = dayRow;
              }
            } else if (dateKey < todayKey) {
              status = 'missed';
            } else {
              status = 'future';
            }

            grid.push({
              dayNumber,
              localDate: dateKey,
              isToday,
              status,
              day: dayRow,
            });
          }

          entries.push({
            habit,
            cycleDay,
            doneCount,
            todayDay,
            grid,
          });
        }

        setData(entries);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error('project habits query failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [db, projectId, todayKey, reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return { data, error, reload };
}
