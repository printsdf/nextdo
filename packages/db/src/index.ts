/**
 * @nextdo/db — PowerSync client schema + Kysely queries + connector.
 * The ONLY PowerSync-client touchpoint in the monorepo (design.md §3).
 *
 * Public surface:
 *   - schema.ts: `AppSchema` (the PowerSync schema — single source of
 *     truth for all client tables)
 *   - powersync.ts: platform client selection (`createPowerSyncDatabase`),
 *     the v2 backend connector (`createPowerSyncConnector`), the single
 *     stream subscription (`subscribeAppStream`)
 *   - owner-token.ts: owner-token storage per the spec platform matrix
 *     (SecureStore / Stronghold / in-memory; the only client-side
 *     key-value access for auth state)
 *   - kysely.ts: `wrapDb` — the app-facing Kysely handle over the PowerSync
 *     client (the app never imports Kysely / the driver itself)
 *   - queries/: the app's read + mutation surface (design.md §3/§4 —
 *     internal query modules are reachable only through this file,
 *     directory-structure.md Rule 3)
 */
export * from './schema';
export * from './powersync';
export * from './owner-token';

// queries — the app-facing query surface (one screen's data + the engine
// pool). Feature tasks extend this list as their screens land.
export { poolWatchQuery, queryEnginePool } from './queries/pool';
export type { EnginePool } from './queries/pool';
export { skipAction } from './queries/actions';
export { listInboxItems } from './queries/inbox';
export { listProjects, projectActionCoverage } from './queries/projects';
export { listReviewRecords } from './queries/reviews';
// Watched-query builders for the app's `@powersync/react` data hooks
// (database-guidelines "@powersync/react boundary").
export {
  inboxItemsWatchQuery,
  poolTriggerWatchQuery,
  projectsWatchQuery,
  reviewRecordsWatchQuery,
} from './queries/watch-queries';
export type { ProjectWithCoverage } from './queries/watch-queries';
export { wrapDb } from './kysely';
export type { ActionKind, NextdoDb } from './types';
