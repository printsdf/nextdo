/**
 * Action-title loader (Re-clarify and Focus screens, design.md §4.3/§4.6):
 * the screen's header shows what is being worked on. Loads through the
 * canonical list query for the action's kind:
 *
 * - next/calendar → the action row's title;
 * - habit → the HabitDay row (no title of its own) → the parent habit's
 *   title (the daily instance is "the habit, today").
 *
 * The same single query also yields the action's `projectId` (null for
 * calendar/habit and for standalone actions) AND its `contextIds`
 * (re-clarify form prefill, design §3.3) — zero extra cost, one query
 * concern (hook-guidelines).
 */
import { useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import {
  listCalendarActions,
  listHabitDays,
  listHabits,
  listNextActions,
  wrapDb,
  type ActionKind,
} from '@nextdo/db';
import { logger } from '@nextdo/core';

export interface UseActionTitleResult {
  title: string | null;
  /** The action's project (next actions only — CalendarAction has no
   *  projectId in v1) — null for standalone actions / not loaded. */
  projectId: string | null;
  /** The action's execution contexts (re-clarify form prefill, design §3.3)
   *  — [] for habits / not loaded. */
  contextIds: string[];
  loaded: boolean;
  error: string | null;
}

export function useActionTitle(
  actionKind: ActionKind | null,
  actionId: string | null,
): UseActionTitleResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const [title, setTitle] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [contextIds, setContextIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (actionKind === null || actionId === null) return;
    let cancelled = false;
    setTitle(null);
    setProjectId(null);
    setContextIds([]);
    setLoaded(false);
    setError(null);

    const settle = (
      foundTitle: string | null,
      foundProjectId: string | null = null,
      foundContextIds: string[] = [],
    ) => {
      if (cancelled) return;
      setTitle(foundTitle);
      setProjectId(foundProjectId);
      setContextIds(foundContextIds);
      setLoaded(true);
    };
    const fail = (err: unknown) => {
      if (cancelled) return;
      logger.error('action title load failed', err instanceof Error ? err : new Error(String(err)));
      setError(err instanceof Error ? err.message : String(err));
      setLoaded(true);
    };

    if (actionKind === 'habit') {
      // HabitDay has no title — resolve through the parent habit.
      Promise.all([listHabitDays(db), listHabits(db)])
        .then(([days, habits]) => {
          const day = days.find((candidate) => candidate.id === actionId);
          if (day === undefined) return settle(null);
          const habit = habits.find((candidate) => candidate.id === day.habitId);
          settle(habit?.title ?? null);
        })
        .catch(fail);
      return () => {
        cancelled = true;
      };
    }

    if (actionKind === 'next') {
      listNextActions(db)
        .then((actions) => {
          const found = actions.find((candidate) => candidate.id === actionId);
          settle(found?.title ?? null, found?.projectId ?? null, found?.contextIds ?? []);
        })
        .catch(fail);
    } else {
      listCalendarActions(db)
        .then((actions) => {
          const found = actions.find((candidate) => candidate.id === actionId);
          settle(found?.title ?? null, null, found?.contextIds ?? []);
        })
        .catch(fail);
    }
    return () => {
      cancelled = true;
    };
  }, [db, actionKind, actionId]);

  return { title, projectId, contextIds, loaded, error };
}
