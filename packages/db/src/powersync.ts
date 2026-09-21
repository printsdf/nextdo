/**
 * PowerSync client connector + platform client selection
 * (spec: app/database-guidelines.md "PowerSync Rules" — this file is the
 * ONLY PowerSync-client touchpoint in the monorepo; design.md §3).
 *
 * - `createPowerSyncDatabase()` — platform client selection at runtime:
 *   native (Expo) → `@powersync/react-native`; web / Tauri desktop / Node →
 *   `@powersync/web`. Both modules are required LAZILY, so importing this
 *   file is safe under plain Node (the jest environment) — the native
 *   module is never loaded there.
 * - `createPowerSyncConnector(config)` — the v2 connector the app passes
 *   to `powersync.connect(connector)`:
 *     * `fetchCredentials()` reads the owner token (owner-token.ts) and
 *       does `GET {backendUrl}/credentials` → `{ token, endpoint }`.
 *       Returns null when no owner token is stored (SDK: not signed in);
 *       throws on network failure / non-2xx (SDK retries).
 *     * `uploadData(database)` is invoked by the SDK in a loop — never
 *       call it directly. Each call takes ONE crud transaction
 *       (`getNextCrudTransaction()`), POSTs its ops to
 *       `POST {backendUrl}/upload` with the owner token, and calls
 *       `transaction.complete()` ONLY after a 2xx (the 2xx-on-rejection
 *       protocol: the backend answers 2xx even for validation-level
 *       rejections — error detail comes back via sync tables; only
 *       transient failures return 5xx). A non-2xx throws, which blocks
 *       the queue for the SDK's retry (official guidance).
 *
 * Upload protocol (consumed by server/app `/upload`): the body is
 * `{ ops: [{ op, id, table, opData }] }` — one entry per ps_crud op
 * (`op` = PUT | PATCH | DELETE).
 *
 * No env-var fallback anywhere (spec: client env values may end up in the
 * build output) — every value comes from the injected `NextdoPowerSyncConfig`.
 */
import type {
  CommonPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
  Schema,
} from '@powersync/common';
import { SyncNextdoError } from '@nextdo/core';
import { AppSchema } from './schema';
import { getOwnerToken } from './owner-token';

/** Config injected by the app (design.md §4: `apps/mobile/lib/env.ts`). */
export interface NextdoPowerSyncConfig {
  /** App backend base URL (server/app) — `/credentials` and `/upload` live here. */
  backendUrl: string;
  /** PowerSync service endpoint — returned to the SDK by `fetchCredentials`. */
  endpoint: string;
}

/** Local database filename (both platform SDKs). */
export const DB_FILENAME = 'nextdo.db';

/**
 * The single v1 sync stream (design.md §3: "stream subscription name —
 * v1: single stream"). The PowerSync service declares it under this name
 * in `server/powersync/sync-config.yaml` (all rows, single user,
 * `auto_subscribe: true`) — the two must match.
 */
export const SYNC_STREAM_NAME = 'all';

/** The platform PowerSync client module (lazy-loaded — see file header). */
export interface PowerSyncClientModule {
  PowerSyncDatabase: new (options: {
    schema: Schema;
    database: { dbFilename: string };
  }) => CommonPowerSyncDatabase;
}

/** React Native runtime check without importing `react-native` (that
 *  module only exists on native; Node/jest must import this file safely). */
export function isReactNativeRuntime(): boolean {
  const product = (globalThis as { navigator?: { product?: string } }).navigator?.product;
  return product === 'ReactNative' || product === 'ReactNativeWebView';
}

/**
 * Load the platform PowerSync client module at runtime. The `require` is
 * the lazy platform switch: Metro bundles it for the app, jest resolves
 * it for the web path, and plain Node never takes the native branch.
 */
export function loadPowerSyncClientModule(): PowerSyncClientModule {
  if (isReactNativeRuntime()) {
    // Lazy platform switch — Metro bundles the native module, jest/Node take
    // the web path. A static import would pull react-native into every build.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@powersync/react-native') as PowerSyncClientModule;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@powersync/web') as PowerSyncClientModule;
}

/**
 * Create the platform PowerSync client (NOT connected — the app calls
 * `connect(createPowerSyncConnector(config))` once, in the root layout).
 */
export function createPowerSyncDatabase(): CommonPowerSyncDatabase {
  const { PowerSyncDatabase } = loadPowerSyncClientModule();
  return new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename: DB_FILENAME } });
}

/**
 * Subscribe to the single v1 stream. The service declares it with
 * `auto_subscribe: true`, so this is a safeguard that keeps the stream
 * name in one place — the app calls it once after `connect()`.
 */
export async function subscribeAppStream(powersync: CommonPowerSyncDatabase): Promise<void> {
  await powersync.syncStream(SYNC_STREAM_NAME, {}).subscribe();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Build the v2 connector for the injected config (see file header). */
export function createPowerSyncConnector(config: NextdoPowerSyncConfig): PowerSyncBackendConnector {
  return {
    async fetchCredentials(): Promise<PowerSyncCredentials | null> {
      const ownerToken = await getOwnerToken();
      if (ownerToken === null) {
        // Not signed in (no owner token stored) — the SDK stays
        // disconnected and re-checks automatically.
        return null;
      }
      let res: Response;
      try {
        res = await fetch(`${config.backendUrl}/credentials`, {
          headers: { Authorization: `Bearer ${ownerToken}` },
        });
      } catch (error) {
        // Network failure — temporary; the SDK retries with backoff.
        throw new SyncNextdoError(
          'credentials.network',
          `GET /credentials failed: ${errorMessage(error)}`,
        );
      }
      if (!res.ok) {
        throw new SyncNextdoError(
          'credentials.rejected',
          `GET /credentials failed with status ${res.status}`,
        );
      }
      const data = (await res.json().catch(() => null)) as { token?: unknown } | null;
      if (data === null || typeof data.token !== 'string' || data.token === '') {
        throw new SyncNextdoError(
          'credentials.invalid',
          'credential response is missing a token',
        );
      }
      return { endpoint: config.endpoint, token: data.token };
    },

    async uploadData(database: CommonPowerSyncDatabase): Promise<void> {
      const transaction = await database.getNextCrudTransaction();
      if (transaction === null) {
        return; // queue empty — the SDK stops looping
      }
      const ownerToken = await getOwnerToken();
      if (ownerToken === null) {
        // Throwing blocks the queue until a token is stored — uploading
        // without the owner token would be a 401 anyway.
        throw new SyncNextdoError(
          'upload.no-owner-token',
          'no owner token stored — cannot upload local changes',
        );
      }
      const ops = transaction.crud.map((entry) => ({
        op: entry.op,
        id: entry.id,
        table: entry.table,
        opData: entry.opData ?? null,
      }));
      let res: Response;
      try {
        res = await fetch(`${config.backendUrl}/upload`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({ ops }),
        });
      } catch (error) {
        throw new SyncNextdoError(
          'upload.network',
          `POST /upload failed: ${errorMessage(error)}`,
        );
      }
      if (!res.ok) {
        // Non-2xx → reject: the SDK retries after its backoff and the
        // queue stays blocked (official guidance).
        throw new SyncNextdoError(
          'upload.rejected',
          `POST /upload failed with status ${res.status}`,
        );
      }
      // 2xx — INCLUDING validation-level rejections (the backend answers
      // 2xx and reports the error detail via sync tables) — the queue
      // advances. Skipping complete() here would leave the queue stuck.
      await transaction.complete();
    },
  };
}
