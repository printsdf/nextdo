/**
 * Query tests — ReviewRecords (spec: domain/domain-model.md "ReviewRecord" —
 * append-only audit trail: there are deliberately NO update or soft-delete
 * functions in the query layer).
 */
import {
  RECLARIFY_THRESHOLD,
  toIso,
  ulid,
  type DailyReviewRecord,
  type WeeklyReviewRecord,
} from '@nextdo/core';
import type { NextdoDb } from '../types';
import {
  buildDailyReviewSnapshot,
  buildWeeklyReviewSnapshot,
  listCompletionRecords,
} from '../queries/reviews';
import { addReviewRecord, listReviewRecords } from '../queries/reviews';
import { openTestDb, type TestDb } from './query-helpers';
import { FIXTURE_IDS, FIXTURE_NOW } from './fixtures';

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

function makeDaily(overrides: Partial<DailyReviewRecord> = {}): DailyReviewRecord {
  return {
    id: ulid(FIXTURE_NOW),
    createdAt: toIso(FIXTURE_NOW),
    updatedAt: toIso(FIXTURE_NOW),
    deletedAt: null,
    kind: 'daily',
    at: toIso(FIXTURE_NOW),
    snapshot: {
      inboxCount: 0,
      completedToday: [],
      stillOpen: [],
      projectsMissingActions: [],
      waitingFollowUps: [],
      calendarToday: [],
      calendarTomorrow: [],
      repeatedSkips: [],
    },
    answers: {
      completedActionIds: [],
      rescheduled: [],
      skippedNoted: [],
      tomorrowMustDo: [],
    },
    ...overrides,
  };
}

function makeWeekly(overrides: Partial<WeeklyReviewRecord> = {}): WeeklyReviewRecord {
  return {
    id: ulid(FIXTURE_NOW),
    createdAt: toIso(FIXTURE_NOW),
    updatedAt: toIso(FIXTURE_NOW),
    deletedAt: null,
    kind: 'weekly',
    at: toIso(FIXTURE_NOW),
    snapshot: {
      inboxCount: 0,
      projects: [],
      waitingFollowUps: [],
      somedayCount: 0,
      stalledProjects: [],
      calendarNext7: [],
    },
    answers: {
      inboxCleared: true,
      followUpsRaised: [],
      calendarReasonable: true,
      somedayDecisions: [],
      projectDecisions: [],
    },
    ...overrides,
  };
}

describe('listReviewRecords', () => {
  it('returns [] on an empty database', async () => {
    const { db, close } = await open();
    try {
      expect(await listReviewRecords(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('lists the seeded daily + weekly records ordered by at', async () => {
    const { db, close } = await open(true);
    try {
      const list = await listReviewRecords(db);
      expect(list).toHaveLength(2);
      expect(list.map((record) => record.id).sort()).toEqual(
        [FIXTURE_IDS.reviews.daily, FIXTURE_IDS.reviews.weekly].sort(),
      );
      expect(list.map((record) => record.kind).sort()).toEqual(['daily', 'weekly']);
    } finally {
      await close();
    }
  });
});

describe('addReviewRecord', () => {
  it('appends a valid daily record', async () => {
    const { db, close } = await open();
    try {
      const record = makeDaily();
      await addReviewRecord(db, record);
      expect(await listReviewRecords(db)).toEqual([record]);
    } finally {
      await close();
    }
  });

  it('appends a valid weekly record', async () => {
    const { db, close } = await open();
    try {
      const record = makeWeekly();
      await addReviewRecord(db, record);
      expect((await listReviewRecords(db)).map((item) => item.kind)).toEqual(['weekly']);
    } finally {
      await close();
    }
  });

  it('rejects a malformed snapshot (typed validation error)', async () => {
    const { db, close } = await open();
    try {
      const bad = makeDaily({ snapshot: { ...makeDaily().snapshot, inboxCount: -1 } });
      await expect(addReviewRecord(db, bad)).rejects.toMatchObject({
        code: 'validation.dailyReview.inboxCount',
      });
      expect(await listReviewRecords(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('rejects an unknown kind', async () => {
    const { db, close } = await open();
    try {
      const bad = makeDaily({ kind: 'monthly' } as unknown as Partial<DailyReviewRecord>);
      await expect(addReviewRecord(db, bad)).rejects.toMatchObject({
        code: 'validation.reviewRecord.kind',
      });
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// listCompletionRecords + buildDaily/WeeklyReviewSnapshot (task 09-22-app-ui-screens)
//
// TZ is pinned to UTC by the test script, so "device-local" == UTC in these
// tests — the local-day boundary cases below are exact.
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const at = (days: number, hours = 0): string =>
  toIso(new Date(FIXTURE_NOW.getTime() + days * DAY_MS + hours * HOUR_MS));

async function insertNextAction(
  db: NextdoDb,
  args: { id: string; createdAt: string; status?: string; consecutiveSkips?: number; projectId?: string },
): Promise<void> {
  await db
    .insertInto('next_actions')
    .values({
      id: args.id,
      created_at: args.createdAt,
      updated_at: args.createdAt,
      deleted_at: null,
      title: `na-${args.id}`,
      status: args.status ?? 'open',
      consecutive_skips: args.consecutiveSkips ?? 0,
      est_minutes: 10,
      value: 3,
      context_ids: '[]',
      project_id: args.projectId ?? null,
    })
    .execute();
}

async function insertCompletion(
  db: NextdoDb,
  args: { id: string; actionId: string; completedAt: string },
): Promise<void> {
  await db
    .insertInto('completion_records')
    .values({
      id: args.id,
      created_at: args.completedAt,
      updated_at: args.completedAt,
      deleted_at: null,
      action_kind: 'next',
      action_id: args.actionId,
      completed_at: args.completedAt,
      est_minutes: 10,
    })
    .execute();
}

async function insertWaiting(db: NextdoDb, args: { id: string; expectedBy: string | null }): Promise<void> {
  await db
    .insertInto('waiting_for_items')
    .values({
      id: args.id,
      created_at: toIso(FIXTURE_NOW),
      updated_at: toIso(FIXTURE_NOW),
      deleted_at: null,
      title: `wait-${args.id}`,
      waiting_on: 'test',
      expected_by: args.expectedBy,
    })
    .execute();
}

async function insertCalendar(db: NextdoDb, args: { id: string; startsAt: string }): Promise<void> {
  await db
    .insertInto('calendar_actions')
    .values({
      id: args.id,
      created_at: toIso(FIXTURE_NOW),
      updated_at: toIso(FIXTURE_NOW),
      deleted_at: null,
      title: `cal-${args.id}`,
      starts_at: args.startsAt,
      context_ids: '[]',
      est_minutes: 10,
      value: 3,
      status: 'open',
    })
    .execute();
}

async function insertProject(
  db: NextdoDb,
  args: { id: string; createdAt: string; status?: string },
): Promise<void> {
  await db
    .insertInto('projects')
    .values({
      id: args.id,
      created_at: args.createdAt,
      updated_at: args.createdAt,
      deleted_at: null,
      title: `proj-${args.id}`,
      outcome: 'done',
      value: 3,
      status: args.status ?? 'active',
    })
    .execute();
}

describe('listCompletionRecords', () => {
  it('returns [] on an empty database', async () => {
    const { db, close } = await open();
    try {
      expect(await listCompletionRecords(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('lists the seeded completions ordered by completedAt', async () => {
    const { db, close } = await open(true);
    try {
      const records = await listCompletionRecords(db);
      expect(records.map((record) => record.id).sort()).toEqual(
        [
          FIXTURE_IDS.completions.naDone,
          FIXTURE_IDS.completions.doNow,
          FIXTURE_IDS.completions.caDone,
        ].sort(),
      );
      // completedAt ascending: naDone(-2d) < doNow(-2d+1h) < caDone(-19.25h)
      expect(records[0]?.actionId).toBe(FIXTURE_IDS.actions.done);
      expect(records[2]?.actionId).toBe(FIXTURE_IDS.calendar.done);
    } finally {
      await close();
    }
  });

  it('filters by actionIds (empty list = no rows)', async () => {
    const { db, close } = await open(true);
    try {
      const records = await listCompletionRecords(db, {
        actionIds: [FIXTURE_IDS.calendar.done],
      });
      expect(records).toHaveLength(1);
      expect(records[0]?.actionId).toBe(FIXTURE_IDS.calendar.done);
      expect(await listCompletionRecords(db, { actionIds: [] })).toEqual([]);
    } finally {
      await close();
    }
  });

  it('filters by since (inclusive boundary)', async () => {
    const { db, close } = await open();
    try {
      const boundary = at(0, -10);
      await insertCompletion(db, { id: ulid(FIXTURE_NOW), actionId: 'a-old', completedAt: at(-1) });
      await insertCompletion(db, { id: ulid(FIXTURE_NOW), actionId: 'a-boundary', completedAt: boundary });
      await insertCompletion(db, { id: ulid(FIXTURE_NOW), actionId: 'a-new', completedAt: at(0, -1) });
      const records = await listCompletionRecords(db, { since: new Date(boundary) });
      expect(records.map((record) => record.actionId).sort()).toEqual(['a-boundary', 'a-new']);
    } finally {
      await close();
    }
  });
});

describe('buildDailyReviewSnapshot', () => {
  it('returns an empty snapshot on an empty database', async () => {
    const { db, close } = await open();
    try {
      await expect(buildDailyReviewSnapshot(db, FIXTURE_NOW)).resolves.toEqual({
        inboxCount: 0,
        completedToday: [],
        stillOpen: [],
        projectsMissingActions: [],
        waitingFollowUps: [],
        calendarToday: [],
        calendarTomorrow: [],
        repeatedSkips: [],
      });
    } finally {
      await close();
    }
  });

  it('derives every field from the seeded fixtures', async () => {
    const { db, close } = await open(true);
    try {
      const snapshot = await buildDailyReviewSnapshot(db, FIXTURE_NOW);
      // 2 live inbox items (the soft-deleted one is excluded).
      expect(snapshot.inboxCount).toBe(2);
      // Every fixture completion sits on a PAST local day (09-19 / 09-20).
      expect(snapshot.completedToday).toEqual([]);
      // All 8 open, non-deleted NextActions — first = oldest (skipped, -6d),
      // last = newest (b, today -2h); the four 09-20T10:00 ties are asserted
      // as a set (created_at ordering only).
      expect(snapshot.stillOpen).toHaveLength(8);
      expect(snapshot.stillOpen[0]).toBe(FIXTURE_IDS.actions.skipped);
      expect(snapshot.stillOpen[7]).toBe(FIXTURE_IDS.actions.b);
      expect(new Set(snapshot.stillOpen)).toEqual(
        new Set([
          FIXTURE_IDS.actions.skipped,
          FIXTURE_IDS.actions.depDone,
          FIXTURE_IDS.actions.window,
          FIXTURE_IDS.actions.a,
          FIXTURE_IDS.actions.blocked,
          FIXTURE_IDS.actions.baseline,
          FIXTURE_IDS.actions.snoozed,
          FIXTURE_IDS.actions.b,
        ]),
      );
      // Only the active, uncovered project (held is on-hold; paper is covered).
      expect(snapshot.projectsMissingActions).toEqual([FIXTURE_IDS.projects.empty]);
      // No fixture waiting item has a PASSED expectedBy (due=+2d, later=unset).
      expect(snapshot.waitingFollowUps).toEqual([]);
      expect(snapshot.calendarToday).toEqual([FIXTURE_IDS.calendar.soon]);
      expect(snapshot.calendarTomorrow).toEqual([FIXTURE_IDS.calendar.tomorrow]);
      // The 3-skip fixture action (RECLARIFY_THRESHOLD = 3).
      expect(snapshot.repeatedSkips).toEqual([FIXTURE_IDS.actions.skipped]);
    } finally {
      await close();
    }
  });

  it('counts completions on the local-day boundary (midnight in, 23:59:59 out)', async () => {
    const { db, close } = await open();
    try {
      // Local midnight of today (TZ pinned to UTC) → today; the instant
      // before → yesterday.
      await insertCompletion(db, { id: ulid(FIXTURE_NOW), actionId: 'a-midnight', completedAt: '2026-09-21T00:00:00.000Z' });
      await insertCompletion(db, { id: ulid(FIXTURE_NOW), actionId: 'a-just-before', completedAt: '2026-09-20T23:59:59.000Z' });
      const snapshot = await buildDailyReviewSnapshot(db, FIXTURE_NOW);
      expect(snapshot.completedToday).toEqual(['a-midnight']);
    } finally {
      await close();
    }
  });

  it('flags repeated skips at exactly 3 consecutive skips, not at 2', async () => {
    const { db, close } = await open();
    try {
      expect(RECLARIFY_THRESHOLD).toBe(3);
      await insertNextAction(db, { id: 'a-two', createdAt: toIso(FIXTURE_NOW), consecutiveSkips: 2 });
      await insertNextAction(db, { id: 'a-three', createdAt: toIso(FIXTURE_NOW), consecutiveSkips: 3 });
      const snapshot = await buildDailyReviewSnapshot(db, FIXTURE_NOW);
      expect(snapshot.repeatedSkips).toEqual(['a-three']);
    } finally {
      await close();
    }
  });

  it('lists waiting items whose expectedBy is today or in the past (not tomorrow)', async () => {
    const { db, close } = await open();
    try {
      await insertWaiting(db, { id: 'w-yesterday', expectedBy: at(-1) });
      await insertWaiting(db, { id: 'w-today', expectedBy: toIso(FIXTURE_NOW) });
      await insertWaiting(db, { id: 'w-tomorrow', expectedBy: at(1) });
      await insertWaiting(db, { id: 'w-unset', expectedBy: null });
      const snapshot = await buildDailyReviewSnapshot(db, FIXTURE_NOW);
      expect(snapshot.waitingFollowUps.sort()).toEqual(['w-today', 'w-yesterday']);
    } finally {
      await close();
    }
  });

  it('buckets calendar actions by local day (today / tomorrow / later)', async () => {
    const { db, close } = await open();
    try {
      await insertCalendar(db, { id: 'c-today', startsAt: at(0, 1) });
      await insertCalendar(db, { id: 'c-tomorrow', startsAt: at(1, 1) });
      await insertCalendar(db, { id: 'c-later', startsAt: at(2, 1) });
      const snapshot = await buildDailyReviewSnapshot(db, FIXTURE_NOW);
      expect(snapshot.calendarToday).toEqual(['c-today']);
      expect(snapshot.calendarTomorrow).toEqual(['c-tomorrow']);
    } finally {
      await close();
    }
  });
});

describe('buildWeeklyReviewSnapshot', () => {
  it('returns an empty snapshot on an empty database', async () => {
    const { db, close } = await open();
    try {
      await expect(buildWeeklyReviewSnapshot(db, FIXTURE_NOW)).resolves.toEqual({
        inboxCount: 0,
        projects: [],
        waitingFollowUps: [],
        somedayCount: 0,
        stalledProjects: [],
        calendarNext7: [],
      });
    } finally {
      await close();
    }
  });

  it('derives every field from the seeded fixtures', async () => {
    const { db, close } = await open(true);
    try {
      const snapshot = await buildWeeklyReviewSnapshot(db, FIXTURE_NOW);
      expect(snapshot.inboxCount).toBe(2);
      // Every non-deleted project, created-ascending (held -20d, paper -14d, empty -10d).
      expect(snapshot.projects.map((project) => project.id)).toEqual([
        FIXTURE_IDS.projects.held,
        FIXTURE_IDS.projects.paper,
        FIXTURE_IDS.projects.empty,
      ]);
      const paper = snapshot.projects.find((project) => project.id === FIXTURE_IDS.projects.paper);
      // Paper's only completion: the done action (naDone, -2d).
      expect(paper).toEqual({
        id: FIXTURE_IDS.projects.paper,
        title: '毕业论文实验',
        hasOpenAction: true,
        lastProgressAt: at(-2),
      });
      const empty = snapshot.projects.find((project) => project.id === FIXTURE_IDS.projects.empty);
      expect(empty?.hasOpenAction).toBe(false);
      expect(empty?.lastProgressAt).toBeNull();
      expect(snapshot.waitingFollowUps).toEqual([]);
      expect(snapshot.somedayCount).toBe(1);
      // paper progressed 2d ago (< 14d); empty was created 10d ago (< 14d);
      // held is on-hold → none stalled.
      expect(snapshot.stalledProjects).toEqual([]);
      expect(snapshot.calendarNext7.sort()).toEqual(
        [FIXTURE_IDS.calendar.soon, FIXTURE_IDS.calendar.tomorrow].sort(),
      );
    } finally {
      await close();
    }
  });

  it('applies the 14-day stall boundary (>= 14d stalled, < 14d not)', async () => {
    const { db, close } = await open();
    try {
      const nowMs = FIXTURE_NOW.getTime();
      const exactly14dAgo = toIso(new Date(nowMs - 14 * DAY_MS));
      const justUnder14dAgo = toIso(new Date(nowMs - 14 * DAY_MS + 60_000));
      const createdAt15dAgo = toIso(new Date(nowMs - 15 * DAY_MS));
      const createdAt13dAgo = toIso(new Date(nowMs - 13 * DAY_MS));

      // Progressed exactly 14 days ago → stalled (inclusive boundary).
      await insertProject(db, { id: 'p-progress-14d', createdAt: toIso(FIXTURE_NOW) });
      await insertNextAction(db, { id: 'a-p1', createdAt: toIso(FIXTURE_NOW), projectId: 'p-progress-14d' });
      await insertCompletion(db, { id: ulid(FIXTURE_NOW), actionId: 'a-p1', completedAt: exactly14dAgo });
      // Progressed 14 days minus a minute ago → not stalled.
      await insertProject(db, { id: 'p-progress-under', createdAt: toIso(FIXTURE_NOW) });
      await insertNextAction(db, { id: 'a-p2', createdAt: toIso(FIXTURE_NOW), projectId: 'p-progress-under' });
      await insertCompletion(db, { id: ulid(FIXTURE_NOW), actionId: 'a-p2', completedAt: justUnder14dAgo });
      // Never completed, created 15 days ago → stalled.
      await insertProject(db, { id: 'p-never-15d', createdAt: createdAt15dAgo });
      // Never completed, created 13 days ago → not stalled.
      await insertProject(db, { id: 'p-never-13d', createdAt: createdAt13dAgo });
      // Old but on-hold → never stalled (active projects only).
      await insertProject(db, { id: 'p-held-old', createdAt: createdAt15dAgo, status: 'on-hold' });

      const snapshot = await buildWeeklyReviewSnapshot(db, FIXTURE_NOW);
      expect(snapshot.stalledProjects.sort()).toEqual(['p-never-15d', 'p-progress-14d']);
    } finally {
      await close();
    }
  });

  it('collects calendar actions starting within the next 7 local days (window-inclusive/exclusive)', async () => {
    const { db, close } = await open();
    try {
      // Window: [today 00:00 local, today+7d 00:00 local) — TZ pinned to UTC.
      const today0000 = '2026-09-21T00:00:00.000Z';
      const plus7d0000 = '2026-09-28T00:00:00.000Z';
      await insertCalendar(db, { id: 'c-at-window-start', startsAt: today0000 });
      await insertCalendar(db, { id: 'c-inside', startsAt: at(6, 12) });
      await insertCalendar(db, { id: 'c-at-window-end', startsAt: plus7d0000 });
      await insertCalendar(db, { id: 'c-before', startsAt: '2026-09-20T23:00:00.000Z' });
      const snapshot = await buildWeeklyReviewSnapshot(db, FIXTURE_NOW);
      expect(snapshot.calendarNext7).toEqual(['c-at-window-start', 'c-inside']);
    } finally {
      await close();
    }
  });
});
