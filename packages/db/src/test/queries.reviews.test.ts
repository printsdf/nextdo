/**
 * Query tests — ReviewRecords (spec: domain/domain-model.md "ReviewRecord" —
 * append-only audit trail: there are deliberately NO update or soft-delete
 * functions in the query layer).
 */
import { toIso, ulid, type DailyReviewRecord, type WeeklyReviewRecord } from '@nextdo/core';
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
