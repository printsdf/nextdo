/**
 * Watched-query builders for the app's data hooks (the `@powersync/react`
 * boundary — database-guidelines). Each returns a `CompilableQuery` (see
 * `../watch-query.ts`) that the app passes straight to `useQuery`; the app
 * never builds Kysely itself.
 *
 * These are the READ-path queries the mobile shell renders. They mirror the
 * plain (non-reactive) list functions in the per-aggregate query modules but
 * are expressed as watchable queries so the React hooks update live.
 */
import { sql } from 'kysely';
import type { InboxItem, Project, ReviewRecord } from '@nextdo/core';
import type { CompilableQuery } from '@powersync/common';
import { inboxItemFromRow, projectFromRow, reviewRecordFromRow } from '../schema';
import { toCompilableQuery } from '../watch-query';
import { poolWatchQuery } from './pool';
import type { NextdoDb } from '../types';

/** Inbox capture list (raw, non-deleted InboxItems, oldest first). */
export function inboxItemsWatchQuery(db: NextdoDb): CompilableQuery<InboxItem> {
  const builder = db
    .selectFrom('inbox_items')
    .selectAll()
    .where('deleted_at', 'is', null)
    .orderBy('captured_at');
  return toCompilableQuery(builder, inboxItemFromRow);
}

/** A project plus its derived action-coverage flag (coverage is always
 *  derived, never stored — domain-model.md). `hasOpenAction` is true when the
 *  project has ≥ 1 open, non-deleted NextAction. */
export interface ProjectWithCoverage extends Project {
  hasOpenAction: boolean;
}

/** Project list with the derived `hasOpenAction` coverage flag. The explicit
 *  column list (schema.ts is the source of truth — a schema change breaks
 *  `projectFromRow`'s type check until this follows) plus the scalar
 *  subquery keep the query a single statement, so PowerSync's table-dependency
 *  tracking re-fires the watch on changes to either `projects` or
 *  `next_actions`. */
export function projectsWatchQuery(db: NextdoDb): CompilableQuery<ProjectWithCoverage> {
  const builder = db
    .selectFrom('projects')
    .select([
      'id',
      'created_at',
      'updated_at',
      'deleted_at',
      'title',
      'outcome',
      'value',
      'status',
      sql<number>`(SELECT COUNT(*) FROM next_actions na
        WHERE na.project_id = projects.id
          AND na.status = 'open'
          AND na.deleted_at IS NULL)`.as('open_action_count'),
    ])
    .where('deleted_at', 'is', null)
    .orderBy('created_at');
  return toCompilableQuery(builder, (row) => ({
    ...projectFromRow(row),
    hasOpenAction: row.open_action_count > 0,
  }));
}

/** Review record list (append-only audit trail, oldest first). */
export function reviewRecordsWatchQuery(db: NextdoDb): CompilableQuery<ReviewRecord> {
  const builder = db
    .selectFrom('review_records')
    .selectAll()
    .where('deleted_at', 'is', null)
    .orderBy('at');
  return toCompilableQuery(builder, (row) => reviewRecordFromRow(row).record);
}

/**
 * Invalidation trigger for the engine pool (see `useActionPool`): one row per
 * pool-relevant table. The rows themselves are unused — the hook recomputes
 * the pool with `queryEnginePool` whenever this watch fires (data change) or
 * the app clock ticks. The union keeps every source table in the SQL so
 * PowerSync tracks all of them as dependencies.
 */
export function poolTriggerWatchQuery(db: NextdoDb): CompilableQuery<{ id: string }> {
  return toCompilableQuery(poolWatchQuery(db));
}
