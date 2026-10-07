/**
 * Pool contract tests (spec: domain/next-action-engine.md "Pool Contract" —
 * the query layer guarantees the engine receives ONLY: open + non-deleted
 * candidates with `dependencyDone` resolved, calendar blocks tagged with
 * `sourceActionId`, and all non-deleted projects. R5: a NextAction bound
 * to a project that is not active (or deleted/missing) is not a candidate.)
 *
 * The engine applies the hard filters itself — the pool must NOT filter on
 * snooze, context, or estimate.
 */
import { toIso, ulid, type ProjectStatus } from '@nextdo/core';
import { completeAction } from '../queries/actions';
import { startHabit } from '../queries/habits';
import { queryEnginePool } from '../queries/pool';
import { listProjects, updateProject } from '../queries/projects';
import { openTestDb, type TestDb } from './query-helpers';
import { FIXTURE_IDS, FIXTURE_NOW } from './fixtures';

const A = FIXTURE_IDS.actions;
const C = FIXTURE_IDS.calendar;
const H = FIXTURE_IDS.habits;
const P = FIXTURE_IDS.projects;

let env: TestDb | null = null;
afterEach(async () => {
  if (env !== null) {
    await env.close();
    env = null;
  }
});
async function open(seed = false, now: Date = FIXTURE_NOW): Promise<TestDb> {
  env = await openTestDb(seed, now);
  return env;
}

/** Move a fixture project through a legal transition via the db-layer
 *  mutation (the same path the app's archive/resume buttons use). */
async function setProjectStatus(db: TestDb['db'], projectId: string, status: ProjectStatus): Promise<void> {
  const projects = await listProjects(db);
  const project = projects.find((entry) => entry.id === projectId);
  if (project === undefined) throw new Error(`fixture project missing: ${projectId}`);
  await updateProject(db, { ...project, status, updatedAt: toIso(FIXTURE_NOW) });
}

describe('queryEnginePool', () => {
  it('returns an empty pool on an empty database', async () => {
    const { db, close } = await open();
    try {
      expect(await queryEnginePool(db, FIXTURE_NOW)).toEqual({ actions: [], calendar: [], projects: [] });
    } finally {
      await close();
    }
  });

  it('open/non-deleted filter: done and trashed actions never enter the pool', async () => {
    const { db, close } = await open(true);
    try {
      const pool = await queryEnginePool(db, FIXTURE_NOW);
      const ids = new Set(pool.actions.map((action) => action.id));
      // every live next action is present…
      for (const id of [A.b, A.a, A.blocked, A.baseline, A.depDone, A.window, A.snoozed, A.skipped]) {
        expect(ids.has(id)).toBe(true);
      }
      // …but not the done one and not the soft-deleted one
      expect(ids.has(A.done)).toBe(false);
      expect(ids.has(A.trashed)).toBe(false);
    } finally {
      await close();
    }
  });

  it('dependencyDone: resolved against the pool contract (done = non-deleted done)', async () => {
    const { db, close } = await open(true);
    try {
      const pool = await queryEnginePool(db, FIXTURE_NOW);
      const byId = new Map(pool.actions.map((action) => [action.id, action.dependencyDone]));
      // depends on the OPEN baseline → blocked
      expect(byId.get(A.blocked)).toBe(false);
      // depends on the done action → free
      expect(byId.get(A.depDone)).toBe(true);
      // no dependency at all → free
      expect(byId.get(A.a)).toBe(true);
    } finally {
      await close();
    }
  });

  it('snoozed actions stay in the pool (the engine hard-filters them)', async () => {
    const { db, close } = await open(true);
    try {
      const pool = await queryEnginePool(db, FIXTURE_NOW);
      const snoozed = pool.actions.find((action) => action.id === A.snoozed);
      expect(snoozed).toBeDefined();
      expect(snoozed?.snoozedUntil).toBe(toIso(new Date(FIXTURE_NOW.getTime() + 3600_000)));
    } finally {
      await close();
    }
  });

  it('today’s open HabitDays of live active habits become candidates with their cycle position', async () => {
    const { db, close } = await open(true);
    try {
      const pool = await queryEnginePool(db, FIXTURE_NOW);
      const habitCandidates = pool.actions
        .filter((action) => action.kind === 'habit')
        .map((action) => {
          const habit = action as { habitId: string; cycleDay: number; cycleDays: number };
          return { habitId: habit.habitId, cycleDay: habit.cycleDay, cycleDays: habit.cycleDays };
        })
        .sort((x, y) => x.cycleDay - y.cycleDay);
      expect(habitCandidates).toEqual([
        { habitId: H.today, cycleDay: 1, cycleDays: 21 },
        { habitId: H.weekdays, cycleDay: 3, cycleDays: 14 },
        { habitId: H.mid, cycleDay: 11, cycleDays: 21 },
        { habitId: H.last, cycleDay: 21, cycleDays: 21 },
      ]);
      // the habit’s window travels with the candidate
      const weekdays = pool.actions.find((action) => {
        return action.kind === 'habit' && (action as { habitId: string }).habitId === H.weekdays;
      });
      expect(weekdays?.windowStart).toBe('07:00');
      expect(weekdays?.windowEnd).toBe('08:00');
      expect(weekdays?.windowDays).toEqual([1, 2, 3, 4, 5]);
    } finally {
      await close();
    }
  });

  it('days of non-active habits (completed / broken) never surface', async () => {
    const { db, close } = await open(true);
    try {
      const pool = await queryEnginePool(db, FIXTURE_NOW);
      const habitIds = new Set(
        pool.actions.filter((action) => action.kind === 'habit').map((action) => (action as { habitId: string }).habitId),
      );
      expect(habitIds.has(H.completed)).toBe(false); // stale open day, habit completed
      expect(habitIds.has(H.broken)).toBe(false); // only a PAST day exists (derived “missed”)
    } finally {
      await close();
    }
  });

  it('calendar: the preemption-window action is a candidate; every open one is a block', async () => {
    const { db, close } = await open(true);
    try {
      const pool = await queryEnginePool(db, FIXTURE_NOW);
      const calendarCandidates = pool.actions.filter((action) => action.kind === 'calendar');
      // `soon` starts in 30 min (inside the 60-min window); `tomorrow` is a
      // hard block only; `done` is neither.
      expect(calendarCandidates.map((action) => action.id)).toEqual([C.soon]);
      const soon = calendarCandidates[0] as { startsAt?: string };
      expect(soon?.startsAt).toBe(toIso(new Date(FIXTURE_NOW.getTime() + 1800_000)));

      const blocks = pool.calendar.sort((x, y) => (x.start < y.start ? -1 : 1));
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toEqual({
        start: toIso(new Date(FIXTURE_NOW.getTime() + 1800_000)),
        end: toIso(new Date(FIXTURE_NOW.getTime() + 3600_000)), // + 30 min estimate
        sourceActionId: C.soon,
      });
      expect(blocks[1]).toEqual({
        start: toIso(new Date(FIXTURE_NOW.getTime() + 86_400_000 + 2 * 3600_000)),
        end: toIso(new Date(FIXTURE_NOW.getTime() + 86_400_000 + 2 * 3600_000 + 45 * 60_000)),
        sourceActionId: C.tomorrow,
      });
    } finally {
      await close();
    }
  });

  it('projects: all non-deleted projects with value + status (the engine checks active)', async () => {
    const { db, close } = await open(true);
    try {
      const pool = await queryEnginePool(db, FIXTURE_NOW);
      const projects = pool.projects.sort((x, y) => (x.id < y.id ? -1 : 1));
      expect(projects).toHaveLength(3);
      const paper = projects.find((project) => project.id === P.paper);
      expect(paper).toEqual({ id: P.paper, value: 4, status: 'active' });
      const held = projects.find((project) => project.id === P.held);
      expect(held?.status).toBe('on-hold');
    } finally {
      await close();
    }
  });

  it('the pool re-derives after state changes (complete the blocking dependency)', async () => {
    const { db, close } = await open(true);
    try {
      await completeAction(db, { actionKind: 'next', actionId: A.baseline, now: FIXTURE_NOW });
      const pool = await queryEnginePool(db, FIXTURE_NOW);
      const blocked = pool.actions.find((action) => action.id === A.blocked);
      expect(blocked?.dependencyDone).toBe(true);
    } finally {
      await close();
    }
  });
});

describe('R5 — project status filter (the pool contract)', () => {
  it('open actions of an active project enter the pool (regression)', async () => {
    const { db, close } = await open(true);
    try {
      const pool = await queryEnginePool(db, FIXTURE_NOW);
      const ids = new Set(pool.actions.map((action) => action.id));
      // A.b and A.depDone are bound to the ACTIVE paper project.
      expect(ids.has(A.b)).toBe(true);
      expect(ids.has(A.depDone)).toBe(true);
    } finally {
      await close();
    }
  });

  it('open actions of an on-hold project leave the pool; resuming brings them back', async () => {
    const { db, close } = await open(true);
    try {
      await setProjectStatus(db, P.paper, 'on-hold');
      let pool = await queryEnginePool(db, FIXTURE_NOW);
      let ids = new Set(pool.actions.map((action) => action.id));
      expect(ids.has(A.b)).toBe(false);
      expect(ids.has(A.depDone)).toBe(false);
      // Resume (on-hold → active): pure derivation, no data moves.
      await setProjectStatus(db, P.paper, 'active');
      pool = await queryEnginePool(db, FIXTURE_NOW);
      ids = new Set(pool.actions.map((action) => action.id));
      expect(ids.has(A.b)).toBe(true);
      expect(ids.has(A.depDone)).toBe(true);
    } finally {
      await close();
    }
  });

  it('open actions of a done / dropped project leave the pool (terminal states)', async () => {
    // done and dropped are terminal — one fresh DB per status.
    for (const status of ['done', 'dropped'] as const) {
      const test = await open(true);
      await setProjectStatus(test.db, P.paper, status);
      const pool = await queryEnginePool(test.db, FIXTURE_NOW);
      const ids = new Set(pool.actions.map((action) => action.id));
      expect(ids.has(A.b)).toBe(false);
      expect(ids.has(A.depDone)).toBe(false);
      env = null; // closed by hand below — skip the afterEach close
      await test.close();
    }
  });

  it('projectless actions are unaffected by any project status', async () => {
    const { db, close } = await open(true);
    try {
      // Every project leaves active — the standalone actions survive.
      await setProjectStatus(db, P.paper, 'on-hold');
      await setProjectStatus(db, P.empty, 'dropped');
      const pool = await queryEnginePool(db, FIXTURE_NOW);
      const ids = new Set(pool.actions.map((action) => action.id));
      for (const id of [A.a, A.blocked, A.baseline, A.window, A.snoozed, A.skipped]) {
        expect(ids.has(id)).toBe(true);
      }
      // …while the project-bound one is out.
      expect(ids.has(A.b)).toBe(false);
      expect(ids.has(A.depDone)).toBe(false);
    } finally {
      await close();
    }
  });

  it('CalendarActions and today’s HabitDays are unaffected by project status (regression)', async () => {
    const { db, close } = await open(true);
    try {
      await setProjectStatus(db, P.paper, 'on-hold');
      const pool = await queryEnginePool(db, FIXTURE_NOW);
      // calendar_actions has no projectId in v1 — `soon` stays a candidate.
      const calendarIds = pool.actions
        .filter((action) => action.kind === 'calendar')
        .map((action) => action.id);
      expect(calendarIds).toEqual([C.soon]);
      // Today's open days of live active habits are unchanged.
      const habitIds = pool.actions
        .filter((action) => action.kind === 'habit')
        .map((action) => (action as { habitId: string }).habitId)
        .sort();
      expect(habitIds).toEqual([H.today, H.mid, H.last, H.weekdays].sort());
    } finally {
      await close();
    }
  });

  it('habit bound to active project inherits projectId; on-hold project removes it; resuming restores it', async () => {
    const { db, close } = await open(true);
    try {
      const { habit } = await startHabit(
        db,
        {
          id: ulid(FIXTURE_NOW),
          createdAt: toIso(FIXTURE_NOW),
          updatedAt: toIso(FIXTURE_NOW),
          deletedAt: null,
          title: '读文献习惯',
          actionTitle: '读一章文献',
          estMinutes: 30,
          value: 4,
          cycleDays: 21,
          startedAt: toIso(FIXTURE_NOW),
          status: 'active',
          projectId: P.paper,
        },
        FIXTURE_NOW,
      );

      // 1. Paper is active -> habit candidate inherits projectId
      let pool = await queryEnginePool(db, FIXTURE_NOW);
      let habitCandidate = pool.actions.find(
        (action) => action.kind === 'habit' && (action as { habitId: string }).habitId === habit.id,
      );
      expect(habitCandidate).toBeDefined();
      expect(habitCandidate?.projectId).toBe(P.paper);

      // 2. Paper set to on-hold -> habit candidate leaves pool
      await setProjectStatus(db, P.paper, 'on-hold');
      pool = await queryEnginePool(db, FIXTURE_NOW);
      habitCandidate = pool.actions.find(
        (action) => action.kind === 'habit' && (action as { habitId: string }).habitId === habit.id,
      );
      expect(habitCandidate).toBeUndefined();

      // 3. Paper resumed to active -> habit candidate returns
      await setProjectStatus(db, P.paper, 'active');
      pool = await queryEnginePool(db, FIXTURE_NOW);
      habitCandidate = pool.actions.find(
        (action) => action.kind === 'habit' && (action as { habitId: string }).habitId === habit.id,
      );
      expect(habitCandidate).toBeDefined();
      expect(habitCandidate?.projectId).toBe(P.paper);
    } finally {
      await close();
    }
  });

  it('projectless habit candidate retains undefined projectId', async () => {
    const { db, close } = await open(true);
    try {
      const pool = await queryEnginePool(db, FIXTURE_NOW);
      const todayHabit = pool.actions.find(
        (action) => action.kind === 'habit' && (action as { habitId: string }).habitId === H.today,
      );
      expect(todayHabit).toBeDefined();
      expect(todayHabit?.projectId).toBeUndefined();
    } finally {
      await close();
    }
  });
});
