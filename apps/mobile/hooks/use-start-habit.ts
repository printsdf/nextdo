/**
 * Habit create mutation (the habits screen's 「开始 21 天挑战」, task
 * 10-02): builds a full Habit row and delegates to the packages/db
 * `startHabit` transaction — the INSERT **and** today's HabitDay seeding
 * happen in ONE local transaction, so the new habit can never exist
 * without its first challenge day.
 *
 * Fixed decisions (design.md §4 / PRD F2–F3): `cycleDays` is 21 (a
 * challenge cycle, never a promise — the UI copy stays factual),
 * `status` is `active`, and `windowDays` is NOT written (undefined =
 * every day; the weekday picker is out of scope).
 *
 * `now` from the single app clock (hook-guidelines Rule 4).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { startHabit, wrapDb } from '@nextdo/db';
import { logger, toIso, ulid, type Value } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

/** The challenge-cycle length (PRD F2 — fixed, not user-editable). */
export const HABIT_CYCLE_DAYS = 21;

export interface StartHabitArgs {
  title: string;
  /** Optional daily-action title; empty inherits `title`. */
  actionTitle: string;
  estMinutes: number;
  value: Value;
  /** At most one project this habit serves; undefined = projectless. */
  projectId?: string;
  /** "HH:mm" pair, or undefined for an all-day habit. */
  windowStart?: string;
  windowEnd?: string;
}

export interface UseStartHabitResult {
  /** Resolves true when the local write committed (false on error). */
  start: (args: StartHabitArgs) => Promise<boolean>;
  error: string | null;
}

export function useStartHabit(): UseStartHabitResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(
    async (args: StartHabitArgs): Promise<boolean> => {
      const nowIso = toIso(now);
      const title = args.title.trim();
      const actionTitle = args.actionTitle.trim();
      try {
        const result = await startHabit(
          db,
          {
            id: ulid(now),
            createdAt: nowIso,
            updatedAt: nowIso,
            deletedAt: null,
            title,
            // The daily action inherits the habit name when the user left
            // the field empty (PRD F2 — the generated HabitDay action).
            actionTitle: actionTitle === '' ? title : actionTitle,
            estMinutes: args.estMinutes,
            value: args.value,
            ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
            ...(args.windowStart !== undefined ? { windowStart: args.windowStart } : {}),
            ...(args.windowEnd !== undefined ? { windowEnd: args.windowEnd } : {}),
            cycleDays: HABIT_CYCLE_DAYS,
            startedAt: nowIso,
            status: 'active' as const,
          },
          now,
        );
        // Cycle day 1 is today, so seeding cannot legitimately fail here
        // (no weekday mask, today inside the cycle). If it ever does, the
        // habit exists without its first day — say so instead of
        // pretending the challenge started (PRD F3).
        if (result.today === null) {
          logger.error(
            'habit start seeded no HabitDay',
            new Error(`habit ${title} started without a challenge day`),
          );
          setError('习惯已创建，但今天的挑战日没有生成，请检查时间窗口。');
          return false;
        }
        setError(null);
        return true;
      } catch (err: unknown) {
        logger.error('habit start failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [db, now],
  );

  return { start, error };
}