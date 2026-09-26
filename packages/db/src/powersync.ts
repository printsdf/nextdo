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
 *       calls `fetchCredentialsOnce()` → `{ token, endpoint }`.
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
 * - `fetchCredentialsOnce(config, ownerToken)` — the ONE place the
 *   `/credentials` wire protocol lives (Bearer GET + response token
 *   check), exported as a pure function: the connector maps its result
 *   back to the null/throw contract, and the app's ConnectGate + startup
 *   pre-check (apps/mobile) call it directly — the PowerSync v2 SDK
 *   swallows credential rejections in its retry loop, so token validity
 *   is checked BEFORE `connect()` (prod-deploy design R3).
 *
 * Upload protocol (consumed by server/app `/upload`): the body is
 * `{ ops: [{ op, id, table, opData }] }` — one entry per ps_crud op
 * (`op` = PUT | PATCH | DELETE).
 *
 * No env-var fallback anywhere (spec: client env values may end up in the
 * build output) — every value comes from the injected `NextdoPowerSyncConfig`.
 */
import { LogLevels } from '@powersync/common';
import type {
  CommonPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
  PowerSyncLogger,
  Schema,
} from '@powersync/common';
import { logger, SyncNextdoError, ValidationNextdoError } from '@nextdo/core';
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

/** The native (React Native/Expo) client module (lazy-loaded — see header). */
export interface PowerSyncClientModule {
  PowerSyncDatabase: new (options: {
    schema: Schema;
    database: { dbFilename: string };
  }) => CommonPowerSyncDatabase;
}

/** The web client module — same constructor plus the wasm-sqlite factory.
 *  (The web SDK runs SQLite (wasm) inside a web worker; see the
 *  react-native-web-support docs.) Shapes mirror `@powersync/web` 2.3.1. */
export interface PowerSyncWebClientModule {
  PowerSyncDatabase: new (options: {
    schema: Schema;
    logger?: PowerSyncLogger;
    factory: unknown;
    sync?: { worker: string };
  }) => CommonPowerSyncDatabase;
  WASQLiteOpenFactory: new (options: {
    open: { dbFilename: string; worker: string };
    logger: PowerSyncLogger;
  }) => unknown;
}

/** Options for `createPowerSyncDatabase`. */
export interface CreatePowerSyncDatabaseOptions {
  /** Web / Tauri only: where the @powersync/web worker asset is served from
   *  (e.g. `/@powersync/worker.js`). Required on the web platform. */
  web?: { workerPath: string };
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
export function loadPowerSyncClientModule(): PowerSyncClientModule | PowerSyncWebClientModule {
  if (isReactNativeRuntime()) {
    // Lazy platform switch — Metro bundles the native module, jest/Node take
    // the web path. A static import would pull react-native into every build.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@powersync/react-native') as PowerSyncClientModule;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@powersync/web') as PowerSyncWebClientModule;
}

/**
 * PowerSync SDK logger → the repo's single logger (project/conventions.md
 * §Logging — the SDK must not emit its own console traffic). Only warn and
 * above surface: the SDK's info-level protocol chatter is noise.
 */
function createSdkLogger(): PowerSyncLogger {
  return {
    log(record) {
      if (record.level >= LogLevels.error) {
        logger.error(`powersync: ${record.message}`, record.error);
      } else if (record.level >= LogLevels.warn) {
        logger.warn(`powersync: ${record.message}`);
      }
    },
  };
}

/**
 * Create the platform PowerSync client (NOT connected — the app calls
 * `connect(createPowerSyncConnector(config))` once, in the root layout).
 *
 * - native (Expo iOS/Android): the RN SDK + the `@op-engineering/op-sqlite`
 *   adapter (autolinked as a direct dependency of the app).
 * - web / Tauri desktop: the web SDK — SQLite (wasm) runs in a web worker,
 *   so the caller must pass `web.workerPath` (the worker asset copied into
 *   the app's `public/` directory; research/versions-powersync.md).
 */
export function createPowerSyncDatabase(
  options?: CreatePowerSyncDatabaseOptions,
): CommonPowerSyncDatabase {
  if (isReactNativeRuntime()) {
    const { PowerSyncDatabase } = loadPowerSyncClientModule() as PowerSyncClientModule;
    return new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename: DB_FILENAME } });
  }
  const workerPath = options?.web?.workerPath;
  if (workerPath === undefined || workerPath === '') {
    throw new ValidationNextdoError(
      'powersync.web-worker-missing',
      'the PowerSync web client needs the worker asset path (options.web.workerPath)',
    );
  }
  const { PowerSyncDatabase, WASQLiteOpenFactory } =
    loadPowerSyncClientModule() as PowerSyncWebClientModule;
  const sdkLogger = createSdkLogger();
  const factory = new WASQLiteOpenFactory({
    open: { dbFilename: DB_FILENAME, worker: workerPath },
    logger: sdkLogger,
  });
  return new PowerSyncDatabase({
    schema: AppSchema,
    factory,
    logger: sdkLogger,
    sync: { worker: workerPath },
  });
}

/**
 * Subscribe to the single v1 stream. The service declares it with
 * `auto_subscribe: true`, so this is a safeguard that keeps the stream
 * name in one place — the app calls it once after `connect()`.
 *
 * Resolves once the subscription is registered. (The default contexts are
 * seeded SERVER-SIDE — server/app/src/seed.ts, single-writer — so the app
 * no longer needs the subscription handle's `waitForFirstSync()` to gate a
 * client-side seed.)
 */
export async function subscribeAppStream(powersync: CommonPowerSyncDatabase): Promise<void> {
  await powersync.syncStream(SYNC_STREAM_NAME, {}).subscribe();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The outcome of one `/credentials` round-trip (prod-deploy design R3).
 * A discriminated union, NEVER a throw: the caller decides what each
 * kind means (the connector maps it to its null/throw contract; the
 * app's Gate maps it to user-facing errors).
 *
 * - `ok` — 2xx with a non-empty token string.
 * - `rejected` — non-2xx (401 = wrong owner token; 5xx = server problem).
 * - `invalid` — 2xx but the body is unparseable or has no token
 *   (a server/protocol bug, distinct from a rejected token).
 * - `network` — the fetch itself failed (offline / DNS / connection
 *   refused); retryable. `detail` carries the underlying error message.
 */
export type FetchCredentialsOnceResult =
  | { ok: true; token: string }
  | { ok: false; kind: 'rejected'; status: number }
  | { ok: false; kind: 'invalid' }
  | { ok: false; kind: 'network'; detail?: string };

/**
 * One Bearer `GET {backendUrl}/credentials` + response-token check — the
 * single owner of the wire protocol (see the file header for why the
 * Gate + startup pre-check need this as a standalone function).
 *
 * Pure with respect to module state: takes the config + token, returns
 * the outcome; the owner token is read by the CALLER (the connector
 * reads it via `getOwnerToken()` so that the "no token → null" branch
 * stays on the connector side).
 */
export async function fetchCredentialsOnce(
  config: NextdoPowerSyncConfig,
  ownerToken: string,
): Promise<FetchCredentialsOnceResult> {
  let res: Response;
  try {
    res = await fetch(`${config.backendUrl}/credentials`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
  } catch (error) {
    return { ok: false, kind: 'network', detail: errorMessage(error) };
  }
  if (!res.ok) {
    return { ok: false, kind: 'rejected', status: res.status };
  }
  const data = (await res.json().catch(() => null)) as { token?: unknown } | null;
  if (data === null || typeof data.token !== 'string' || data.token === '') {
    return { ok: false, kind: 'invalid' };
  }
  return { ok: true, token: data.token };
}

/** Build the v2 connector for the injected config (see file header). */
export function createPowerSyncConnector(config: NextdoPowerSyncConfig): PowerSyncBackendConnector {
  return {
    async fetchCredentials(): Promise<PowerSyncCredentials | null> {
      const ownerToken = await getOwnerToken();
      if (ownerToken === null) {
        // Signed out (no owner token stored). This null is the SDK's
        // "not signed in" signal — but the SDK does NOT idle on it: its
        // sync loop would retry buildRequest() and log "Not signed in"
        // every cycle. The app owns the lifecycle (root layout) and must
        // not connect() while this returns null (it disconnects instead).
        return null;
      }
      // One round-trip via the shared protocol function (fetchCredentialsOnce
      // never throws — each kind maps back to the SDK's contract below).
      const result = await fetchCredentialsOnce(config, ownerToken);
      if (result.ok) {
        return { endpoint: config.endpoint, token: result.token };
      }
      if (result.kind === 'network') {
        // Network failure — temporary; the SDK retries with backoff.
        throw new SyncNextdoError(
          'credentials.network',
          `GET /credentials failed: ${result.detail ?? 'network error'}`,
        );
      }
      if (result.kind === 'invalid') {
        throw new SyncNextdoError(
          'credentials.invalid',
          'credential response is missing a token',
        );
      }
      throw new SyncNextdoError(
        'credentials.rejected',
        `GET /credentials failed with status ${result.status}`,
      );
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
