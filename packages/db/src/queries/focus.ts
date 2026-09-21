/**
 * FocusSession queries (spec: domain/domain-model.md "FocusSession").
 *
 * The live in-progress session is persisted as an `active` row from the
 * moment it starts (app kill/restart recovers it). Transitions go through
 * core's `FOCUS_SESSION_TRANSITIONS` — one transaction each:
 *
 * - `startFocusSession` → an `active` row (elapsed = endedAt − startedAt −
 *   pausedSec once it leaves active);
 * - `recordPause` → accumulates `pausedSec` (the pause-START instant is UI
 *   state; the total is written back here) — active rows only;
 * - `completeFocusSession` / `abandonFocusSession` → set the terminal
 *   status + `endedAt`.
 *
 * **Timer end ≠ task complete** (domain-model.md): completing a session
 * does NOT complete the action — that is a separate, explicit user
 * confirmation that runs the canonical complete transaction (queries/actions.ts).
 */
import {
  FOCUS_SESSION_TRANSITIONS,
  StorageNextdoError,
  ValidationNextdoError,
  assertTransition,
  assertValidFocusSession,
  toIso,
  ulid,
  type FocusSession,
  type FocusSessionStatus,
  type ReminderActionKind,
} from '@nextdo/core';
import { focusSessionFromRow, focusSessionToRow, type Database } from '../schema';
import type { NextdoDb } from '../types';

async function loadSessionRow(db: NextdoDb, sessionId: string): Promise<Database['focus_sessions']> {
  const row = await db
    .selectFrom('focus_sessions')
    .selectAll()
    .where('id', '=', sessionId)
    .executeTakeFirst();
  if (row === undefined || row.deleted_at !== null) {
    throw new StorageNextdoError('focusSession.not-found', `No live FocusSession with id ${sessionId}`);
  }
  return row;
}

// ---------------------------------------------------------------------------
// Reads + creation
// ---------------------------------------------------------------------------

export async function listFocusSessions(
  db: NextdoDb,
  options?: { includeDeleted?: boolean; actionId?: string },
): Promise<FocusSession[]> {
  let query = db.selectFrom('focus_sessions').selectAll();
  if (options?.actionId !== undefined) {
    query = query.where('action_id', '=', options.actionId);
  }
  if (!options?.includeDeleted) {
    query = query.where('deleted_at', 'is', null);
  }
  const rows = await query.orderBy('started_at').execute();
  return rows.map(focusSessionFromRow);
}

/** Plain insert (full row) — validated by core's `assertValidFocusSession`
 *  (preset ∈ {25,45,60} vs free = null, pausedSec ≥ 0, endedAt rules). */
export async function addFocusSession(db: NextdoDb, session: FocusSession): Promise<FocusSession> {
  assertValidFocusSession(session);
  await db
    .insertInto('focus_sessions')
    .values({ id: session.id, ...focusSessionToRow(session) })
    .execute();
  return session;
}

/** Start the live session: an `active` row from this moment on. */
export async function startFocusSession(
  db: NextdoDb,
  args: {
    actionId: string;
    actionKind: ReminderActionKind;
    mode: FocusSession['mode'];
    plannedMinutes: number | null;
    now: Date;
  },
): Promise<FocusSession> {
  const nowIso = toIso(args.now);
  const session: FocusSession = {
    id: ulid(args.now),
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: null,
    actionId: args.actionId,
    actionKind: args.actionKind,
    mode: args.mode,
    plannedMinutes: args.plannedMinutes,
    startedAt: nowIso,
    pausedSec: 0,
    status: 'active',
  };
  assertValidFocusSession(session);
  await db
    .insertInto('focus_sessions')
    .values({ id: session.id, ...focusSessionToRow(session) })
    .execute();
  return session;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * Write back the accumulated paused seconds (absolute total, computed by
 * the UI from the pause-start instant it keeps in state). Active rows only
 * — a terminal session's elapsed time is frozen.
 */
export async function recordPause(
  db: NextdoDb,
  args: { sessionId: string; pausedSec: number; now: Date },
): Promise<FocusSession> {
  const nowIso = toIso(args.now);
  const row = await loadSessionRow(db, args.sessionId);
  if (row.status !== 'active') {
    throw new ValidationNextdoError(
      'focusSession.not-active',
      `Only an active focus session can record paused time (id ${args.sessionId} is ${String(row.status)})`,
    );
  }
  if (typeof args.pausedSec !== 'number' || args.pausedSec < 0) {
    throw new ValidationNextdoError(
      'validation.focusSession.pausedSec',
      'focusSession.pausedSec must be >= 0',
    );
  }
  await db
    .updateTable('focus_sessions')
    .set({ paused_sec: args.pausedSec, updated_at: nowIso })
    .where('id', '=', args.sessionId)
    .execute();
  return { ...focusSessionFromRow(row), pausedSec: args.pausedSec, updatedAt: nowIso };
}

/** The user finishes (or the timer ends and the user confirms). Does NOT
 *  complete the action — see the file header. */
export async function completeFocusSession(
  db: NextdoDb,
  args: { sessionId: string; now: Date },
): Promise<FocusSession> {
  const nowIso = toIso(args.now);
  const row = await loadSessionRow(db, args.sessionId);
  assertTransition(
    FOCUS_SESSION_TRANSITIONS,
    row.status as FocusSessionStatus,
    'completed',
    args.now,
  );
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable('focus_sessions')
      .set({ status: 'completed', ended_at: nowIso, updated_at: nowIso })
      .where('id', '=', args.sessionId)
      .execute();
  });
  return { ...focusSessionFromRow(row), status: 'completed', endedAt: nowIso, updatedAt: nowIso };
}

/** The user stops early. The row is kept (with pausedSec and elapsed) so
 *  time spent is visible in review. Abandon does not touch the action. */
export async function abandonFocusSession(
  db: NextdoDb,
  args: { sessionId: string; now: Date },
): Promise<FocusSession> {
  const nowIso = toIso(args.now);
  const row = await loadSessionRow(db, args.sessionId);
  assertTransition(
    FOCUS_SESSION_TRANSITIONS,
    row.status as FocusSessionStatus,
    'abandoned',
    args.now,
  );
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable('focus_sessions')
      .set({ status: 'abandoned', ended_at: nowIso, updated_at: nowIso })
      .where('id', '=', args.sessionId)
      .execute();
  });
  return { ...focusSessionFromRow(row), status: 'abandoned', endedAt: nowIso, updatedAt: nowIso };
}
