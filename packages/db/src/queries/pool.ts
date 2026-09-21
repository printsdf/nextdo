/**
 * Engine pool query (spec: domain/next-action-engine.md "Contract" —
 * "Pool contract (enforced by the packages/db pool query, trusted by the
 * engine)"):
 *
 * - only open, non-deleted candidates — done/deleted filtering is the
 *   pool's job, not the engine's;
 * - dependencyDone = the referenced action is done (or no dependency);
 * - the pool tags CalendarBlocks that originate from an open CalendarAction
 *   with its `sourceActionId`.
 *
 * The app fills in `context` and `now` to build the full `EngineInput`.
 * `now` is injected (device clock) — never read here.
 */
import {
  localDateKey,
  parseIso,
  toIso,
  type CalendarBlock,
  type CandidateAction,
  type CandidateBase,
} from '@nextdo/core';
import { parseJson } from '../schema';
import type { NextdoDb } from '../types';

export interface EnginePool {
  /** open NextActions + today's open HabitDays + CalendarActions (today or starting soon). */
  actions: CandidateAction[];
  /** Hard schedule blocks — v1: all other open CalendarActions. */
  calendar: CalendarBlock[];
  /** All non-deleted projects (the engine checks `status` itself). */
  projects: { id: string; value: number; status: string }[];
}

const PREEMPTION_WINDOW_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

function baseFromRow(row: {
  id: string;
  title: string | null;
  context_ids: string | null;
  est_minutes: number | null;
  value: number | null;
  category: string | null;
  project_id?: string | null;
  depends_on_id?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  window_days?: string | null;
  due_date?: string | null;
  deadline?: string | null;
  snoozed_until?: string | null;
  last_snoozed_at?: string | null;
  consecutive_skips?: number | null;
  last_skipped_at?: string | null;
  created_at: string | null;
}): CandidateBase {
  return {
    id: row.id,
    kind: 'next', // overwritten per candidate kind
    title: row.title ?? '',
    contextIds: parseJson<string[]>(row.context_ids, []),
    estMinutes: row.est_minutes ?? 0,
    value: (row.value ?? 3) as CandidateBase['value'],
    category: row.category as CandidateBase['category'],
    projectId: row.project_id ?? undefined,
    dependsOnId: row.depends_on_id ?? undefined,
    windowStart: row.window_start ?? undefined,
    windowEnd: row.window_end ?? undefined,
    windowDays: parseJson<number[] | null>(row.window_days, null) ?? undefined,
    dueDate: row.due_date ?? undefined,
    deadline: row.deadline ?? undefined,
    snoozedUntil: row.snoozed_until ?? undefined,
    consecutiveSkips: row.consecutive_skips ?? 0,
    lastSkippedAt: row.last_skipped_at ?? undefined,
    dependencyDone: true, // resolved below
    createdAt: row.created_at ?? '',
    lastSnoozedAt: row.last_snoozed_at ?? undefined,
  };
}

/**
 * 1-based cycle day for a HabitDay row within its habit's challenge cycle
 * (null when the local date falls outside the cycle).
 *
 * Exported: shared by the pool query and the `startHabit` seeding
 * (queries/habits.ts) — the generation logic lives in ONE place.
 */
export function habitCycleDay(startedAt: string, cycleDays: number, localDate: string): number | null {
  const startedAtMs = parseIso(startedAt).getTime();
  for (let day = 0; day < cycleDays; day++) {
    if (localDateKey(new Date(startedAtMs + day * DAY_MS)) === localDate) {
      return day + 1;
    }
  }
  return null;
}

export async function queryEnginePool(db: NextdoDb, now: Date): Promise<EnginePool> {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayIso = toIso(startOfToday);
  const soonIso = toIso(new Date(now.getTime() + PREEMPTION_WINDOW_MS));
  const todayKey = localDateKey(now);

  // Pool contract: ids of DONE (non-deleted) actions, per kind.
  const doneIds = new Set<string>();
  for (const table of ['next_actions', 'calendar_actions', 'habit_days'] as const) {
    const rows = await db
      .selectFrom(table)
      .select('id')
      .where('status', '=', 'done')
      .where('deleted_at', 'is', null)
      .execute();
    for (const row of rows) {
      doneIds.add(row.id);
    }
  }
  const resolveDependency = (dependsOnId?: string): boolean =>
    dependsOnId === undefined || doneIds.has(dependsOnId);

  const actions: CandidateAction[] = [];

  // 1. Open NextActions.
  const nextRows = await db
    .selectFrom('next_actions')
    .selectAll()
    .where('status', '=', 'open')
    .where('deleted_at', 'is', null)
    .execute();
  for (const row of nextRows) {
    actions.push({ ...baseFromRow(row), kind: 'next', dependencyDone: resolveDependency(row.depends_on_id ?? undefined) });
  }

  // 2. Today's open HabitDays (of live, active habits).
  const dayRows = await db
    .selectFrom('habit_days')
    .selectAll()
    .where('status', '=', 'open')
    .where('deleted_at', 'is', null)
    .where('local_date', '=', todayKey)
    .execute();
  const habitRows = await db.selectFrom('habits').selectAll().execute();
  const habitById = new Map(habitRows.map((habit) => [habit.id, habit]));
  for (const day of dayRows) {
    const habit = habitById.get(day.habit_id ?? '');
    if (habit === undefined || habit.deleted_at !== null || habit.status !== 'active') {
      continue;
    }
    const cycleDays = habit.cycle_days ?? 0;
    const cycleDay = habitCycleDay(habit.started_at ?? '', cycleDays, day.local_date ?? '');
    if (cycleDay === null) {
      continue;
    }
    actions.push({
      ...baseFromRow({
        ...day,
        title: habit.action_title ?? null,
        context_ids: null,
        est_minutes: habit.est_minutes ?? null,
        value: habit.value ?? null,
        category: habit.category ?? null,
        // The day row has no window columns — the window belongs to the
        // habit (spec: window-mismatch filter + habit-commitment signal).
        window_start: habit.window_start ?? null,
        window_end: habit.window_end ?? null,
        window_days: habit.window_days ?? null,
      }),
      kind: 'habit',
      habitId: habit.id,
      cycleDay,
      cycleDays,
    });
  }

  // 3. CalendarActions: today or starting soon (preemption window).
  const calendarRows = await db
    .selectFrom('calendar_actions')
    .selectAll()
    .where('status', '=', 'open')
    .where('deleted_at', 'is', null)
    .execute();
  const blocks: CalendarBlock[] = [];
  for (const row of calendarRows) {
    const startsAt = row.starts_at;
    if (startsAt === null) {
      continue;
    }
    // Hard schedule block for every open CalendarAction.
    const endMs = parseIso(startsAt).getTime() + (row.est_minutes ?? 0) * 60_000;
    blocks.push({ start: startsAt, end: toIso(new Date(endMs)), sourceActionId: row.id });
    // Candidate only within today / starting soon.
    if (startsAt < todayIso || startsAt > soonIso) {
      continue;
    }
    actions.push({ ...baseFromRow(row), kind: 'calendar', startsAt });
  }

  // Projects (all non-deleted; the engine applies the `active` check).
  const projectRows = await db
    .selectFrom('projects')
    .select(['id', 'value', 'status'])
    .where('deleted_at', 'is', null)
    .execute();
  const projects = projectRows.map((row) => ({
    id: row.id,
    value: row.value ?? 3,
    status: row.status ?? '',
  }));

  return { actions, calendar: blocks, projects };
}

/**
 * Watch-query builder for the engine pool (the app's `useActionPool` hook
 * wraps this in its `@powersync/react` watch-query subscription —
 * database-guidelines "@powersync/react boundary"; hook-guidelines "the
 * hook owns the subscription").
 *
 * It is an INVALIDATION TRIGGER, not a data query: it selects one row from
 * every table `queryEnginePool` reads, so any change to pool-relevant rows
 * re-fires the subscription. The subscription's result rows are unused —
 * the pool itself is always recomputed by `queryEnginePool`, which stays
 * the single home of pool logic (hook-guidelines: "Add the query in
 * packages/db/src/queries, then a thin hook around it").
 */
export function poolWatchQuery(db: NextdoDb) {
  return db
    .selectFrom('next_actions')
    .select('id')
    .union(db.selectFrom('habit_days').select('id'))
    .union(db.selectFrom('habits').select('id'))
    .union(db.selectFrom('calendar_actions').select('id'))
    .union(db.selectFrom('projects').select('id'));
}
