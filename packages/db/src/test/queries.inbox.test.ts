/**
 * Query tests — Inbox capture + the Clarify decision table application
 * (spec: domain/domain-model.md "The Clarify Decision Table").
 *
 * Every outcome of core's table is exercised: the target row(s) are
 * created in ONE transaction and the InboxItem is soft-deleted; incomplete
 * answers throw BEFORE any write.
 */
import { toIso, ulid, type ClarifyAnswers, type InboxItem, type Value } from '@nextdo/core';
import {
  addInboxItem,
  applyClarify,
  listInboxItems,
  reclarifyAction,
  trashInboxItem,
  updateInboxItem,
  type ReclarifyAnswers,
} from '../queries/inbox';
import { listNextActions } from '../queries/actions';
import { openTestDb, type TestDb } from './query-helpers';
import { FIXTURE_IDS, FIXTURE_NOW } from './fixtures';

const I = FIXTURE_IDS.inbox;
const A = FIXTURE_IDS.actions;

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

function makeInboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: ulid(FIXTURE_NOW),
    createdAt: toIso(FIXTURE_NOW),
    updatedAt: toIso(FIXTURE_NOW),
    deletedAt: null,
    title: '随手记',
    capturedAt: toIso(FIXTURE_NOW),
    ...overrides,
  };
}

/** The full answer shape (interface-required fields) for a branch. */
function answers(overrides: Partial<ClarifyAnswers> = {}): ClarifyAnswers {
  return {
    actionable: true,
    multipleSteps: false,
    twoMinutes: false,
    myResponsibility: false,
    fixedTime: false,
    ...overrides,
  };
}

describe('capture CRUD', () => {
  it('lists [] on an empty database', async () => {
    const { db, close } = await open();
    try {
      expect(await listInboxItems(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('lists live captures ordered by captured_at (trashed excluded)', async () => {
    const { db, close } = await open(true);
    try {
      const list = await listInboxItems(db);
      expect(list.map((item) => item.id)).toEqual([I.old, I.plain]);
      expect(await listInboxItems(db, { includeDeleted: true })).toHaveLength(3);
    } finally {
      await close();
    }
  });

  it('add: inserts a valid capture; rejects an empty title', async () => {
    const { db, close } = await open();
    try {
      const item = makeInboxItem();
      await addInboxItem(db, item);
      expect(await listInboxItems(db)).toEqual([item]);
      await expect(addInboxItem(db, makeInboxItem({ title: '' }))).rejects.toMatchObject({
        code: 'validation.inboxItem.title',
      });
    } finally {
      await close();
    }
  });

  it('update: replaces the row; throws not-found when missing', async () => {
    const { db, close } = await open();
    try {
      const item = makeInboxItem();
      await addInboxItem(db, item);
      const updated = { ...item, title: '改标题', updatedAt: toIso(FIXTURE_NOW) };
      await updateInboxItem(db, updated);
      expect((await listInboxItems(db))[0]?.title).toBe('改标题');
      await expect(updateInboxItem(db, makeInboxItem())).rejects.toMatchObject({
        code: 'inbox.not-found',
      });
    } finally {
      await close();
    }
  });

  it('trash: soft-deletes once; a second trash throws not-found', async () => {
    const { db, close } = await open();
    try {
      const item = makeInboxItem();
      await addInboxItem(db, item);
      await trashInboxItem(db, { id: item.id, now: FIXTURE_NOW });
      expect(await listInboxItems(db)).toEqual([]);
      await expect(trashInboxItem(db, { id: item.id, now: FIXTURE_NOW })).rejects.toMatchObject({
        code: 'inbox.not-found',
      });
    } finally {
      await close();
    }
  });
});

describe('applyClarify', () => {
  it('reference: creates a ReferenceItem and soft-deletes the inbox item', async () => {
    const { db, close } = await open(true);
    try {
      const result = await applyClarify(db, {
        inboxId: I.plain,
        answers: answers({ actionable: false, nonActionableKind: 'reference' }),
        target: { url: 'https://example.com' },
        now: FIXTURE_NOW,
      });
      expect(result.outcome).toEqual({ kind: 'reference' });
      expect(result.createdIds).toHaveLength(1);
      expect(await listInboxItems(db)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: I.plain })]));
      const row = await db
        .selectFrom('reference_items')
        .selectAll()
        .where('id', '=', result.createdIds[0] as string)
        .executeTakeFirst();
      expect(row).toMatchObject({ title: '回复李老师的邮件', url: 'https://example.com', deleted_at: null });
    } finally {
      await close();
    }
  });

  it('someday: creates a SomedayMaybeItem', async () => {
    const { db, close } = await open(true);
    try {
      const result = await applyClarify(db, {
        inboxId: I.plain,
        answers: answers({ actionable: false, nonActionableKind: 'someday' }),
        target: { note: '等秋天再说' },
        now: FIXTURE_NOW,
      });
      expect(result.outcome).toEqual({ kind: 'someday' });
      const row = await db
        .selectFrom('someday_maybe_items')
        .selectAll()
        .where('id', '=', result.createdIds[0] as string)
        .executeTakeFirst();
      expect(row?.note).toBe('等秋天再说');
    } finally {
      await close();
    }
  });

  it('trash: no target row is created; the inbox item is soft-deleted', async () => {
    const { db, close } = await open(true);
    try {
      const result = await applyClarify(db, {
        inboxId: I.plain,
        answers: answers({ actionable: false, nonActionableKind: 'trash' }),
        target: {},
        now: FIXTURE_NOW,
      });
      expect(result.outcome).toEqual({ kind: 'trash' });
      expect(result.createdIds).toEqual([]);
      const row = await db.selectFrom('inbox_items').selectAll().where('id', '=', I.plain).executeTakeFirst();
      expect(row?.deleted_at).toBe(toIso(FIXTURE_NOW));
    } finally {
      await close();
    }
  });

  it('do-now completed: CompletionRecord(actionKind do_now) — no action entity', async () => {
    const { db, close } = await open(true);
    try {
      const result = await applyClarify(db, {
        inboxId: I.plain,
        answers: answers({ twoMinutes: true, completedOnTheSpot: true }),
        target: {},
        now: FIXTURE_NOW,
      });
      expect(result.outcome).toEqual({ kind: 'do-now-completed' });
      const record = await db
        .selectFrom('completion_records')
        .selectAll()
        .where('action_id', '=', I.plain)
        .executeTakeFirst();
      expect(record).toMatchObject({ action_kind: 'do_now', est_minutes: null });
      expect(await listNextActions(db)).toHaveLength(9);
    } finally {
      await close();
    }
  });

  it('two-minute (not completed on the spot): NextAction with the default value 3', async () => {
    const { db, close } = await open(true);
    try {
      const result = await applyClarify(db, {
        inboxId: I.plain,
        answers: answers({ twoMinutes: true, completedOnTheSpot: false }),
        target: { estMinutes: 5 },
        now: FIXTURE_NOW,
      });
      expect(result.outcome).toEqual({ kind: 'next-action', source: 'two-minute' });
      const action = (await listNextActions(db)).find((item) => item.id === result.createdIds[0]);
      expect(action?.value).toBe(3 as Value);
      expect(action?.estMinutes).toBe(5);
      expect(action?.sourceInboxId).toBe(I.plain);
    } finally {
      await close();
    }
  });

  it('project: Project + its first NextAction are created atomically', async () => {
    const { db, close } = await open(true);
    try {
      const before = (await db.selectFrom('projects').selectAll().execute()).length;
      const result = await applyClarify(db, {
        inboxId: I.plain,
        answers: answers({ multipleSteps: true, projectOutcome: '设备恢复可用' }),
        target: { projectValue: 4, estMinutes: 30, actionTitle: '报修第一台' },
        now: FIXTURE_NOW,
      });
      expect(result.outcome).toEqual({ kind: 'project' });
      expect(result.createdIds).toHaveLength(2);
      expect((await db.selectFrom('projects').selectAll().execute()).length).toBe(before + 1);
      const projectId = result.createdIds[0] as string;
      const action = (await listNextActions(db)).find((item) => item.id === result.createdIds[1]);
      expect(action?.projectId).toBe(projectId);
      expect(action?.title).toBe('报修第一台');
    } finally {
      await close();
    }
  });

  it('waiting-for: creates a WaitingForItem (waitingOn required)', async () => {
    const { db, close } = await open(true);
    try {
      const result = await applyClarify(db, {
        inboxId: I.plain,
        answers: answers(),
        target: { waitingOn: '导师' },
        now: FIXTURE_NOW,
      });
      expect(result.outcome).toEqual({ kind: 'waiting-for' });
      const row = await db
        .selectFrom('waiting_for_items')
        .selectAll()
        .where('id', '=', result.createdIds[0] as string)
        .executeTakeFirst();
      expect(row?.waiting_on).toBe('导师');
    } finally {
      await close();
    }
  });

  it('calendar-action: creates a CalendarAction (startsAt required)', async () => {
    const { db, close } = await open(true);
    try {
      const result = await applyClarify(db, {
        inboxId: I.plain,
        answers: answers({ myResponsibility: true, fixedTime: true }),
        target: { estMinutes: 60, startsAt: toIso(new Date(FIXTURE_NOW.getTime() + 7200_000)) },
        now: FIXTURE_NOW,
      });
      expect(result.outcome).toEqual({ kind: 'calendar-action' });
      const row = await db
        .selectFrom('calendar_actions')
        .selectAll()
        .where('id', '=', result.createdIds[0] as string)
        .executeTakeFirst();
      expect(row?.starts_at).toBe(toIso(new Date(FIXTURE_NOW.getTime() + 7200_000)));
    } finally {
      await close();
    }
  });

  it('incomplete answers throw BEFORE any write (inbox stays live)', async () => {
    const { db, close } = await open(true);
    try {
      await expect(
        applyClarify(db, { inboxId: I.plain, answers: answers({ actionable: false }), target: {}, now: FIXTURE_NOW }),
      ).rejects.toMatchObject({ code: 'clarify.incomplete' });
      const row = await db.selectFrom('inbox_items').selectAll().where('id', '=', I.plain).executeTakeFirst();
      expect(row?.deleted_at).toBeNull();
    } finally {
      await close();
    }
  });

  it('a project without an outcome is rejected', async () => {
    const { db, close } = await open(true);
    try {
      await expect(
        applyClarify(db, {
          inboxId: I.plain,
          answers: answers({ multipleSteps: true }),
          target: { projectValue: 4, estMinutes: 30 },
          now: FIXTURE_NOW,
        }),
      ).rejects.toMatchObject({ code: 'project.needs-outcome' });
    } finally {
      await close();
    }
  });

  it('an action outcome without estMinutes is rejected', async () => {
    const { db, close } = await open(true);
    try {
      await expect(
        applyClarify(db, {
          inboxId: I.plain,
          answers: answers({ myResponsibility: true, fixedTime: false }),
          target: {},
          now: FIXTURE_NOW,
        }),
      ).rejects.toMatchObject({ code: 'clarify.est-minutes' });
    } finally {
      await close();
    }
  });

  it('throws not-found for a missing inbox item', async () => {
    const { db, close } = await open(true);
    try {
      await expect(
        applyClarify(db, { inboxId: '01TST0000000000000000000099', answers: answers(), target: {}, now: FIXTURE_NOW }),
      ).rejects.toMatchObject({ code: 'inbox.not-found' });
    } finally {
      await close();
    }
  });
});

describe('reclarifyAction', () => {
  const reclarify = (overrides: Partial<ReclarifyAnswers> = {}): ReclarifyAnswers => ({
    multipleSteps: false,
    twoMinutes: false,
    myResponsibility: true,
    fixedTime: false,
    ...overrides,
  });

  it('replaces a next action (old row soft-deleted, replacement carries replacesActionId)', async () => {
    const { db, close } = await open(true);
    try {
      const result = await reclarifyAction(db, {
        actionKind: 'next',
        actionId: A.a,
        answers: reclarify({ twoMinutes: true }),
        target: { estMinutes: 5, title: '重新澄清后的标题' },
        now: FIXTURE_NOW,
      });
      expect(result.outcome).toEqual({ kind: 'next-action', source: 'two-minute' });
      expect(result.createdIds).toHaveLength(1);
      const list = await listNextActions(db);
      expect(list.map((item) => item.id)).not.toContain(A.a);
      const replacement = list.find((item) => item.id === result.createdIds[0]);
      expect(replacement?.title).toBe('重新澄清后的标题');
      expect(replacement?.replacesActionId).toBe(A.a);
      // the old row is kept (soft-deleted) for history
      const oldRow = await db.selectFrom('next_actions').selectAll().where('id', '=', A.a).executeTakeFirst();
      expect(oldRow?.deleted_at).toBe(toIso(FIXTURE_NOW));
    } finally {
      await close();
    }
  });

  it('do-now re-clarify completes the action in place (canonical transaction)', async () => {
    const { db, close } = await open(true);
    try {
      const result = await reclarifyAction(db, {
        actionKind: 'next',
        actionId: A.a,
        answers: reclarify({ twoMinutes: true, completedOnTheSpot: true }),
        target: {},
        now: FIXTURE_NOW,
      });
      expect(result.outcome).toEqual({ kind: 'do-now-completed' });
      expect(result.createdIds).toEqual([]);
      const action = (await listNextActions(db)).find((item) => item.id === A.a);
      expect(action?.status).toBe('done');
      const record = await db
        .selectFrom('completion_records')
        .selectAll()
        .where('action_id', '=', A.a)
        .executeTakeFirst();
      expect(record).toMatchObject({ action_kind: 'next', est_minutes: 10 });
    } finally {
      await close();
    }
  });

  it('refuses habits (habits are edited, not re-clarified)', async () => {
    const { db, close } = await open(true);
    try {
      await expect(
        reclarifyAction(db, {
          actionKind: 'habit',
          actionId: 'whatever',
          answers: reclarify(),
          target: {},
          now: FIXTURE_NOW,
        }),
      ).rejects.toMatchObject({ code: 'reclarify.unsupported-kind' });
    } finally {
      await close();
    }
  });

  it('refuses a non-open action', async () => {
    const { db, close } = await open(true);
    try {
      await expect(
        reclarifyAction(db, {
          actionKind: 'next',
          actionId: A.done,
          answers: reclarify(),
          target: { estMinutes: 10 },
          now: FIXTURE_NOW,
        }),
      ).rejects.toMatchObject({ code: 'reclarify.action-not-open' });
    } finally {
      await close();
    }
  });
});
