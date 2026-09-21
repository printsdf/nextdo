/**
 * Project queries + action-coverage derivation
 * (spec: domain/domain-model.md "Project" — "Coverage is always derived,
 * never stored").
 *
 * Coverage is a query, not a stored counter: a project is "covered" when it
 * has ≥ 1 open, non-deleted NextAction. `completeAction` deliberately does
 * NOT update anything here — the derivation below sees the new state.
 */
import {
  PROJECT_TRANSITIONS,
  StorageNextdoError,
  assertTransition,
  assertValidProject,
  parseIso,
  toIso,
  type Project,
  type ProjectStatus,
} from '@nextdo/core';
import { projectFromRow, projectToRow } from '../schema';
import type { NextdoDb } from '../types';

async function loadProjectRow(db: NextdoDb, projectId: string) {
  const row = await db
    .selectFrom('projects')
    .selectAll()
    .where('id', '=', projectId)
    .executeTakeFirst();
  if (row === undefined || row.deleted_at !== null) {
    throw new StorageNextdoError('project.not-found', `No live project with id ${projectId}`);
  }
  return row;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listProjects(
  db: NextdoDb,
  options?: { includeDeleted?: boolean },
): Promise<Project[]> {
  let query = db.selectFrom('projects').selectAll();
  if (!options?.includeDeleted) {
    query = query.where('deleted_at', 'is', null);
  }
  const rows = await query.orderBy('created_at').execute();
  return rows.map(projectFromRow);
}

export async function addProject(db: NextdoDb, project: Project): Promise<Project> {
  assertValidProject(project);
  await db.insertInto('projects').values({ id: project.id, ...projectToRow(project) }).execute();
  return project;
}

/**
 * Full-row update. A status change is a lifecycle transition and is
 * asserted against core's `PROJECT_TRANSITIONS` (done/dropped are terminal)
 * before writing.
 */
export async function updateProject(db: NextdoDb, project: Project): Promise<Project> {
  assertValidProject(project);
  const previous = await loadProjectRow(db, project.id);
  const previousStatus = projectFromRow(previous).status;
  if (previousStatus !== project.status) {
    assertTransition(PROJECT_TRANSITIONS, previousStatus as ProjectStatus, project.status, parseIso(project.updatedAt));
  }
  await db
    .updateTable('projects')
    .set({ ...projectToRow(project) })
    .where('id', '=', project.id)
    .execute();
  return project;
}

/** Soft delete (Trash = deleted_at set, domain-model.md). */
export async function trashProject(db: NextdoDb, args: { id: string; now: Date }): Promise<void> {
  const nowIso = toIso(args.now);
  await loadProjectRow(db, args.id);
  await db
    .updateTable('projects')
    .set({ deleted_at: nowIso, updated_at: nowIso })
    .where('id', '=', args.id)
    .execute();
}

// ---------------------------------------------------------------------------
// Coverage (derived, never stored)
// ---------------------------------------------------------------------------

/**
 * Does the project have ≥ 1 open, non-deleted NextAction?
 * Throws `project.not-found` when the project row is missing or trashed.
 */
export async function getProjectCoverage(db: NextdoDb, projectId: string): Promise<boolean> {
  await loadProjectRow(db, projectId);
  const row = await db
    .selectFrom('next_actions')
    .select('id')
    .where('project_id', '=', projectId)
    .where('status', '=', 'open')
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * The active projects lacking an open NextAction
 * (domain-model.md: "projectActionCoverage() returns the active projects
 * lacking an open action" — the weekly review screen and the engine query
 * this; nothing bumps a stored counter).
 */
export async function projectActionCoverage(db: NextdoDb): Promise<Project[]> {
  const projectRows = await db
    .selectFrom('projects')
    .selectAll()
    .where('deleted_at', 'is', null)
    .where('status', '=', 'active')
    .execute();
  const openRows = await db
    .selectFrom('next_actions')
    .select('project_id')
    .where('project_id', 'is not', null)
    .where('status', '=', 'open')
    .where('deleted_at', 'is', null)
    .execute();
  const coveredIds = new Set(openRows.map((row) => row.project_id as string));
  return projectRows
    .map(projectFromRow)
    .filter((project) => !coveredIds.has(project.id));
}
