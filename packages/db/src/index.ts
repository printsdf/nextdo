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
 */
export * from './schema';
export * from './powersync';
export * from './owner-token';
