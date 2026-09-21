/**
 * The app-facing Kysely handle (design.md §3: "every query function takes an
 * injected `db` handle"; Kysely integration goes through
 * `@powersync/kysely-driver` — database-guidelines).
 *
 * The app never touches Kysely or the driver directly: it calls
 * `wrapDb(powersync)` once (in its data hooks, memoized on the context
 * instance) and passes the result to the `packages/db` query and
 * watch-query builders. All Kysely stays in this package (Rule 1).
 */
import type { CommonPowerSyncDatabase } from '@powersync/common';
import { wrapPowerSyncWithKysely } from '@powersync/kysely-driver';
import type { Database } from './schema';
import type { NextdoDb } from './types';

/** Wrap the platform PowerSync client with the Kysely query interface. */
export function wrapDb(powersync: CommonPowerSyncDatabase): NextdoDb {
  return wrapPowerSyncWithKysely<Database>(powersync);
}
