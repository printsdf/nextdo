/**
 * Inbox (capture) queries + the Clarify transitions
 * (spec: domain/domain-model.md "The Clarify Decision Table",
 * next-action-engine.md "Skip & Re-clarify").
 *
 * - capture: list / add / update / soft-delete InboxItems — raw captures
 *   only (invariant 1: no contexts, estimates, or values);
 * - `applyClarify`: walks core's Clarify decision table for an InboxItem
 *   and resolves it in ONE local transaction — the target row(s) are
 *   created (Project + first NextAction atomically, Proposal §5.3) and the
 *   InboxItem is soft-deleted. Target rows carry `sourceInboxId` where the
 *   model has the column (NextAction / CalendarAction); the soft-deleted
 *   InboxItem row is the history elsewhere.
 * - `reclarifyAction`: engine-triggered re-clarify re-enters the table at
 *   question 2 for an existing action; the outcome replaces the old action
 *   row (soft-deleted; the replacement carries `replacesActionId`).
 *
 * `now` is always injected — never the device clock.
 */
import {
  NEXT_ACTION_DEFAULT_VALUE,
  StorageNextdoError,
  ValidationNextdoError,
  assertValidCalendarAction,
  assertValidCompletionRecord,
  assertValidInboxItem,
  assertValidNextAction,
  assertValidProject,
  assertValidReferenceItem,
  assertValidSomedayMaybeItem,
  assertValidWaitingForItem,
  classifyInboxItem,
  toIso,
  ulid,
  type ActionCategory,
  type CalendarAction,
  type ClarifyAnswers,
  type ClarifyOutcome,
  type CompletionRecord,
  type InboxItem,
  type NextAction,
  type Project,
  type ReferenceItem,
  type SomedayMaybeItem,
  type Value,
  type WaitingForItem,
} from '@nextdo/core';
import {
  calendarActionToRow,
  completionRecordToRow,
  inboxItemFromRow,
  inboxItemToRow,
  nextActionToRow,
  projectToRow,
  referenceItemToRow,
  somedayMaybeItemToRow,
  waitingForItemToRow,
  type Database,
} from '../schema';
import { completeAction, loadActionRow } from './actions';
import type { ActionKind, NextdoDb } from '../types';

// ---------------------------------------------------------------------------
// Capture CRUD
// ---------------------------------------------------------------------------

async function loadInboxRow(db: NextdoDb, inboxId: string) {
  const row = await db
    .selectFrom('inbox_items')
    .selectAll()
    .where('id', '=', inboxId)
    .executeTakeFirst();
  if (row === undefined || row.deleted_at !== null) {
    throw new StorageNextdoError('inbox.not-found', `No live InboxItem with id ${inboxId}`);
  }
  return row;
}

export async function listInboxItems(
  db: NextdoDb,
  options?: { includeDeleted?: boolean },
): Promise<InboxItem[]> {
  let query = db.selectFrom('inbox_items').selectAll();
  if (!options?.includeDeleted) {
    query = query.where('deleted_at', 'is', null);
  }
  const rows = await query.orderBy('captured_at').execute();
  return rows.map(inboxItemFromRow);
}

export async function addInboxItem(db: NextdoDb, item: InboxItem): Promise<InboxItem> {
  assertValidInboxItem(item);
  await db
    .insertInto('inbox_items')
    .values({ id: item.id, ...inboxItemToRow(item) })
    .execute();
  return item;
}

export async function updateInboxItem(db: NextdoDb, item: InboxItem): Promise<InboxItem> {
  assertValidInboxItem(item);
  await loadInboxRow(db, item.id);
  await db
    .updateTable('inbox_items')
    .set({ ...inboxItemToRow(item) })
    .where('id', '=', item.id)
    .execute();
  return item;
}

/** Soft delete (Trash = deleted_at set, domain-model.md). */
export async function trashInboxItem(
  db: NextdoDb,
  args: { id: string; now: Date },
): Promise<void> {
  const nowIso = toIso(args.now);
  await loadInboxRow(db, args.id);
  await db
    .updateTable('inbox_items')
    .set({ deleted_at: nowIso, updated_at: nowIso })
    .where('id', '=', args.id)
    .execute();
}

// ---------------------------------------------------------------------------
// Clarify decision table
// ---------------------------------------------------------------------------

/**
 * Target-row fields that core's `ClarifyAnswers` does not carry (the answer
 * shape is frozen in packages/core — the UI collects these while walking
 * the table). Fields apply per outcome:
 *
 * - reference: `url?`, `note?`
 * - someday: `note?`
 * - waiting-for: `waitingOn` (required), `expectedBy?`
 * - project: `projectTitle?`, `projectValue` (required), `actionTitle?` +
 *   the shared action fields for the project's first NextAction
 * - next-action / calendar-action: the shared action fields
 *   (`estMinutes` required for every action outcome)
 *
 * `title` defaults to the InboxItem title (or the existing action's title
 * on re-clarify).
 */
export interface ClarifyTarget {
  title?: string;
  url?: string;
  note?: string;
  waitingOn?: string;
  expectedBy?: string;
  projectTitle?: string;
  projectValue?: Value;
  actionTitle?: string;
  estMinutes?: number;
  contextIds?: string[];
  value?: Value;
  category?: ActionCategory;
  dueDate?: string;
  deadline?: string;
  dependsOnId?: string;
  windowStart?: string;
  windowEnd?: string;
  windowDays?: number[];
  startsAt?: string;
}

export interface ClarifyResult {
  /** The soft-deleted InboxItem id. */
  inboxId: string;
  outcome: ClarifyOutcome;
  /** Ids of every row created (project + first action when applicable). */
  createdIds: string[];
}

/** Re-clarify answers: the decision table from question 2 onwards. */
export interface ReclarifyAnswers {
  /** Q2: 需要多个步骤吗？ */
  multipleSteps: boolean;
  /** Required when `multipleSteps`: the project outcome. */
  projectOutcome?: string;
  /** Q3: 约 2 分钟内能完成吗？ */
  twoMinutes: boolean;
  /** Q3 follow-up: completed on the spot? */
  completedOnTheSpot?: boolean;
  /** Q4: 应该由我完成吗？ */
  myResponsibility: boolean;
  /** Q5: 必须在特定日期/时间执行吗？ */
  fixedTime: boolean;
}

export interface ReclarifyResult {
  outcome: ClarifyOutcome;
  /** Ids of every replacement row created (empty for the do-now path — it
   *  completes the action in place via the canonical complete transaction). */
  createdIds: string[];
}

function requireEstMinutes(target: ClarifyTarget, where: string): number {
  if (typeof target.estMinutes !== 'number' || target.estMinutes <= 0) {
    throw new ValidationNextdoError(
      'clarify.est-minutes',
      `Clarifying to ${where} requires estMinutes > 0`,
    );
  }
  return target.estMinutes;
}

function requireProjectValue(target: ClarifyTarget): Value {
  if (typeof target.projectValue !== 'number' || target.projectValue < 1 || target.projectValue > 5) {
    throw new ValidationNextdoError(
      'clarify.project-value',
      'Clarifying to a project requires projectValue 1..5',
    );
  }
  return target.projectValue;
}

function buildNextAction(
  now: Date,
  base: { nowIso: string; title: string; projectId?: string; sourceInboxId?: string; replacesActionId?: string; keptValue?: Value },
  target: ClarifyTarget,
): NextAction {
  return {
    id: ulid(now),
    createdAt: base.nowIso,
    updatedAt: base.nowIso,
    deletedAt: null,
    title: target.title ?? base.title,
    projectId: base.projectId,
    contextIds: target.contextIds ?? [],
    estMinutes: requireEstMinutes(target, 'a next action'),
    // Two-minute path: the spec default (3); clarified path: the user-set
    // value; re-clarify: keep the old action's value unless changed.
    value: target.value ?? base.keptValue ?? NEXT_ACTION_DEFAULT_VALUE,
    category: target.category,
    dueDate: target.dueDate,
    deadline: target.deadline,
    dependsOnId: target.dependsOnId,
    windowStart: target.windowStart,
    windowEnd: target.windowEnd,
    windowDays: target.windowDays,
    consecutiveSkips: 0,
    status: 'open',
    sourceInboxId: base.sourceInboxId,
    replacesActionId: base.replacesActionId,
  };
}

function buildCalendarAction(
  now: Date,
  base: { nowIso: string; title: string; sourceInboxId?: string; replacesActionId?: string; keptValue?: Value },
  target: ClarifyTarget,
): CalendarAction {
  return {
    id: ulid(now),
    createdAt: base.nowIso,
    updatedAt: base.nowIso,
    deletedAt: null,
    title: target.title ?? base.title,
    startsAt: target.startsAt ?? '',
    contextIds: target.contextIds ?? [],
    estMinutes: requireEstMinutes(target, 'a calendar action'),
    value: target.value ?? base.keptValue ?? NEXT_ACTION_DEFAULT_VALUE,
    category: target.category,
    deadline: target.deadline,
    consecutiveSkips: 0,
    status: 'open',
    sourceInboxId: base.sourceInboxId,
    replacesActionId: base.replacesActionId,
  };
}

/**
 * Resolve an InboxItem through the Clarify decision table.
 *
 * ONE transaction: create the target row(s) (all-or-nothing — a Project and
 * its first NextAction are created atomically) and soft-delete the
 * InboxItem. Throws before any write when the answers are incomplete
 * (core: `clarify.incomplete`, `project.needs-outcome`) or a required
 * target field is missing (`clarify.est-minutes`, `clarify.project-value`).
 */
export async function applyClarify(
  db: NextdoDb,
  args: { inboxId: string; answers: ClarifyAnswers; target: ClarifyTarget; now: Date },
): Promise<ClarifyResult> {
  const { inboxId, answers, target, now } = args;
  const nowIso = toIso(now);
  const inbox = inboxItemFromRow(await loadInboxRow(db, inboxId));

  // Core's decision table — throws ValidationNextdoError on incomplete
  // answers (e.g. a project without an outcome).
  const outcome = classifyInboxItem(answers);
  const base = { nowIso, title: inbox.title, sourceInboxId: inbox.id };

  const createdIds: string[] = [];
  await db.transaction().execute(async (tx) => {
    switch (outcome.kind) {
      case 'trash':
        break;
      case 'reference': {
        const item: ReferenceItem = {
          id: ulid(now),
          createdAt: nowIso,
          updatedAt: nowIso,
          deletedAt: null,
          title: target.title ?? inbox.title,
          url: target.url,
          note: target.note,
        };
        assertValidReferenceItem(item);
        createdIds.push(item.id);
        await tx.insertInto('reference_items').values({ id: item.id, ...referenceItemToRow(item) }).execute();
        break;
      }
      case 'someday': {
        const item: SomedayMaybeItem = {
          id: ulid(now),
          createdAt: nowIso,
          updatedAt: nowIso,
          deletedAt: null,
          title: target.title ?? inbox.title,
          note: target.note,
        };
        assertValidSomedayMaybeItem(item);
        createdIds.push(item.id);
        await tx.insertInto('someday_maybe_items').values({ id: item.id, ...somedayMaybeItemToRow(item) }).execute();
        break;
      }
      case 'do-now-completed': {
        // DO NOW, completed on the spot: CompletionRecord(actionKind
        // "do_now", actionId = sourceInboxId, estMinutes = null — no
        // estimate ever existed). No action entity is ever created.
        const record: CompletionRecord = {
          id: ulid(now),
          createdAt: nowIso,
          updatedAt: nowIso,
          deletedAt: null,
          actionKind: 'do_now',
          actionId: inbox.id,
          completedAt: nowIso,
          estMinutes: null,
        };
        assertValidCompletionRecord(record);
        createdIds.push(record.id);
        await tx.insertInto('completion_records').values({ id: record.id, ...completionRecordToRow(record) }).execute();
        break;
      }
      case 'project': {
        const projectValue = requireProjectValue(target);
        const project: Project = {
          id: ulid(now),
          createdAt: nowIso,
          updatedAt: nowIso,
          deletedAt: null,
          title: target.projectTitle ?? inbox.title,
          outcome: answers.projectOutcome ?? '',
          value: projectValue,
          status: 'active',
        };
        assertValidProject(project);
        const action = buildNextAction(now, { ...base, projectId: project.id, title: target.actionTitle ?? inbox.title }, target);
        assertValidNextAction(action);
        createdIds.push(project.id, action.id);
        await tx.insertInto('projects').values({ id: project.id, ...projectToRow(project) }).execute();
        await tx.insertInto('next_actions').values({ id: action.id, ...nextActionToRow(action) }).execute();
        break;
      }
      case 'waiting-for': {
        const item: WaitingForItem = {
          id: ulid(now),
          createdAt: nowIso,
          updatedAt: nowIso,
          deletedAt: null,
          title: target.title ?? inbox.title,
          waitingOn: target.waitingOn ?? '',
          expectedBy: target.expectedBy,
        };
        // throws validation.waitingForItem.waitingOn when empty
        assertValidWaitingForItem(item);
        createdIds.push(item.id);
        await tx.insertInto('waiting_for_items').values({ id: item.id, ...waitingForItemToRow(item) }).execute();
        break;
      }
      case 'calendar-action': {
        const action = buildCalendarAction(now, base, target);
        // throws validation.calendarAction.startsAt when missing
        assertValidCalendarAction(action);
        createdIds.push(action.id);
        await tx.insertInto('calendar_actions').values({ id: action.id, ...calendarActionToRow(action) }).execute();
        break;
      }
      case 'next-action': {
        const action = buildNextAction(now, base, target);
        assertValidNextAction(action);
        createdIds.push(action.id);
        await tx.insertInto('next_actions').values({ id: action.id, ...nextActionToRow(action) }).execute();
        break;
      }
    }
    // Every outcome: the InboxItem is soft-deleted in the same transaction.
    await tx
      .updateTable('inbox_items')
      .set({ deleted_at: nowIso, updated_at: nowIso })
      .where('id', '=', inboxId)
      .execute();
  });

  return { inboxId, outcome, createdIds };
}

/**
 * Engine-triggered re-clarify (next-action-engine.md "Skip & Re-clarify"):
 * re-enters the Clarify table at question 2 for an existing action.
 *
 * - the action must be `open` (terminal rows are never re-clarified);
 * - only `next` / `calendar` kinds qualify — a habit day is changed by
 *   editing the habit, not by re-clarifying;
 * - do-now, completed on the spot → the canonical complete transaction
 *   (the action row stays, marked done);
 * - every other outcome → ONE transaction: create the replacement row(s)
 *   (carrying `replacesActionId` and the old row's `sourceInboxId` chain)
 *   and soft-delete the old action row.
 */
export async function reclarifyAction(
  db: NextdoDb,
  args: {
    actionKind: ActionKind;
    actionId: string;
    answers: ReclarifyAnswers;
    target: ClarifyTarget;
    now: Date;
  },
): Promise<ReclarifyResult> {
  const { actionKind, actionId, answers, target, now } = args;
  const nowIso = toIso(now);

  if (actionKind === 'habit') {
    throw new ValidationNextdoError(
      'reclarify.unsupported-kind',
      'Re-clarify applies to next and calendar actions; habits are changed by editing the habit',
    );
  }

  const row = await loadActionRow(db, actionKind, actionId);
  if (row.status !== 'open') {
    throw new ValidationNextdoError(
      'reclarify.action-not-open',
      `Only an open action can be re-clarified (id ${actionId} is ${String(row.status)})`,
    );
  }
  // `habit` was rejected above — the row is a next/calendar action row.
  const actionRow = row as Database['next_actions'] | Database['calendar_actions'];
  const oldTitle = actionRow.title ?? '';
  const oldSourceInboxId = actionRow.source_inbox_id ?? undefined;
  const oldKeptValue = (actionRow.value ?? NEXT_ACTION_DEFAULT_VALUE) as Value;

  // Question 1 was already answered YES for this existing action — the
  // table is re-entered at question 2.
  const outcome = classifyInboxItem({ actionable: true, ...answers });

  if (outcome.kind === 'do-now-completed') {
    // Completed on the spot → the canonical complete transaction
    // (status done + CompletionRecord + Reminder cancel, one transaction).
    await completeAction(db, { actionKind, actionId, now });
    return { outcome, createdIds: [] };
  }

  const table = actionKind === 'next' ? 'next_actions' : 'calendar_actions';
  const replacementBase = {
    nowIso,
    title: oldTitle,
    sourceInboxId: oldSourceInboxId,
    replacesActionId: actionId,
    keptValue: oldKeptValue,
  };

  const createdIds: string[] = [];
  await db.transaction().execute(async (tx) => {
    switch (outcome.kind) {
      case 'reference':
      case 'someday':
      case 'trash':
        // Unreachable — re-entering at question 2 (actionable = true) has
        // no non-actionable branches.
        break;
      case 'project': {
        const projectValue = requireProjectValue(target);
        const project: Project = {
          id: ulid(now),
          createdAt: nowIso,
          updatedAt: nowIso,
          deletedAt: null,
          title: target.projectTitle ?? oldTitle,
          outcome: answers.projectOutcome ?? '',
          value: projectValue,
          status: 'active',
        };
        assertValidProject(project);
        const action = buildNextAction(now, { ...replacementBase, projectId: project.id, title: target.actionTitle ?? oldTitle }, target);
        assertValidNextAction(action);
        createdIds.push(project.id, action.id);
        await tx.insertInto('projects').values({ id: project.id, ...projectToRow(project) }).execute();
        await tx.insertInto('next_actions').values({ id: action.id, ...nextActionToRow(action) }).execute();
        break;
      }
      case 'waiting-for': {
        const item: WaitingForItem = {
          id: ulid(now),
          createdAt: nowIso,
          updatedAt: nowIso,
          deletedAt: null,
          title: target.title ?? oldTitle,
          waitingOn: target.waitingOn ?? '',
          expectedBy: target.expectedBy,
        };
        assertValidWaitingForItem(item);
        createdIds.push(item.id);
        await tx.insertInto('waiting_for_items').values({ id: item.id, ...waitingForItemToRow(item) }).execute();
        break;
      }
      case 'calendar-action': {
        const action = buildCalendarAction(now, replacementBase, target);
        assertValidCalendarAction(action);
        createdIds.push(action.id);
        await tx.insertInto('calendar_actions').values({ id: action.id, ...calendarActionToRow(action) }).execute();
        break;
      }
      case 'next-action': {
        const action = buildNextAction(now, replacementBase, target);
        assertValidNextAction(action);
        createdIds.push(action.id);
        await tx.insertInto('next_actions').values({ id: action.id, ...nextActionToRow(action) }).execute();
        break;
      }
      // 'do-now-completed' is unreachable here — handled above (before this
      // transaction) via the canonical complete path.
    }
    // The old action row is soft-deleted; the replacement(s) carry
    // replacesActionId + the preserved sourceInboxId chain.
    await tx
      .updateTable(table)
      .set({ deleted_at: nowIso, updated_at: nowIso })
      .where('id', '=', actionId)
      .execute();
  });

  return { outcome, createdIds };
}
