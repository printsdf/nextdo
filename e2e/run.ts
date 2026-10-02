/**
 * E2E sync round-trip — verification protocol (task 09-22-e2e-sync-roundtrip,
 * prd.md Steps 1–7).
 *
 * Drives the REAL product chain end to end:
 *   - server/powersync/docker-compose.yml (postgres:16-alpine +
 *     journeyapps/powersync-service:1.26.1)
 *   - server/app built and run on the host (:8787) against real Postgres
 *   - the @nextdo/db product code: `createPowerSyncConnector`,
 *     `subscribeAppStream`, `SYNC_STREAM_NAME`, owner-token storage
 *     (`__setStorageBackendForTests` + in-memory backend), `AppSchema`,
 *     `wrapDb`
 *   - a real PowerSync client on Node.
 *
 * CLIENT SDK NOTE (PRD deviation — flagged in the task report): the PRD named
 * `@powersync/web` + the SDK's `{ opened: DBAdapter }` hook (the
 * packages/db/src/test/powersync-node.ts pattern). That web-SDK path cannot
 * exercise the sync protocol on plain Node: the web SDK auto-detects SSR
 * (no `window` global) and selects its no-op SSR sync implementation
 * (`SSRStreamingSyncImplementation` in @powersync/web — connect /
 * triggerCrudUpload / requestCheckpoint are documented no-ops there). So the
 * client is the FIRST-PARTY Node SDK `@powersync/node` (already a
 * devDependency of packages/db — no new dependency; same PowerSync C
 * extension + node:sqlite mechanism as the test harness, same shared
 * protocol code, real WebSocket/fetch). Everything else (connector,
 * schema, stream, owner token, server, docker stack) is untouched product
 * code.
 *
 * NOT part of the root pnpm test/lint/typecheck gates (see README.md).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ulid } from '../packages/core/src/index.ts';
import {
  AppSchema,
  SYNC_STREAM_NAME,
  __setStorageBackendForTests,
  createPowerSyncConnector,
  setOwnerToken,
  subscribeAppStream,
  wrapDb,
  type NextdoDb,
} from '../packages/db/src/index.ts';

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const POWERSYNC_DIR = join(REPO_ROOT, 'server', 'powersync');
const SERVER_APP_DIR = join(REPO_ROOT, 'server', 'app');

const BACKEND_URL = 'http://localhost:8787';
const BACKEND_PORT = 8787;
const SERVICE_URL = 'http://localhost:8080';
const PG_USER = 'nextdo';
const PG_DB = 'nextdo';

const WAIT = {
  stackHealthyMs: 3 * 60_000,
  serviceReadyMs: 2 * 60_000,
  serverBuildMs: 5 * 60_000,
  imagePullMs: 15 * 60_000,
  serverUpMs: 60_000,
  connectMs: 45_000,
  readPathMs: 45_000,
  writePathMs: 45_000,
  queueDrainMs: 45_000,
  crossClientMs: 60_000,
};

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function msg(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Race a promise against a timeout. The input promise gets a no-op catch
 *  so a late rejection (e.g. after we moved on) never becomes an
 *  unhandled rejection.
 *
 *  The timer is REF'd (it must be able to keep the event loop alive and
 *  fire — an unref'd timer can never wake a drained loop, so a promise
 *  that never settles would kill the process with "unsettled top-level
 *  await" before the timeout could reject) and cleared as soon as the
 *  race settles, so a won race leaves no lingering handle behind. */
async function awaitWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  p.catch(() => undefined); // silence late unhandled rejections
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${label}`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Poll `fn` (null = not yet) until it returns a value or the deadline. */
async function pollUntil<T>(
  label: string,
  fn: () => Promise<T | null>,
  timeoutMs: number,
  intervalMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  for (;;) {
    try {
      const value = await fn();
      if (value !== null && value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for ${label}` +
          (lastError ? ` (last probe error: ${msg(lastError)})` : ''),
      );
    }
    await sleep(intervalMs);
  }
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

/** spawnSync wrapper that throws with the output tail on failure. */
function runCmd(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  options?: { env?: NodeJS.ProcessEnv },
): RunResult {
  const r = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: options?.env ?? process.env,
  });
  if (r.error !== undefined && r.status === null) {
    return { status: null, stdout: r.stdout ?? '', stderr: String(r.error), error: r.error };
  }
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function tail(text: string, lines = 30): string {
  const all = text.split('\n');
  return all.slice(-lines).join('\n');
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolveP) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolveP(true);
    });
    socket.once('error', () => resolveP(false));
  });
}

/** Run SQL in the compose Postgres (the same DSN server/app uses). */
function psql(sql: string): string {
  const r = runCmd(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', PG_USER, '-d', PG_DB, '-tA', '-c', sql],
    POWERSYNC_DIR,
    60_000,
  );
  if (r.status !== 0) {
    throw new Error(`psql failed (exit ${r.status}): ${tail(r.stderr, 5)}\nSQL: ${sql}`);
  }
  return r.stdout.replace(/\n+$/, '');
}

/** `docker compose ps` as { service: { state, health } }. */
function composeServices(): Record<string, { state: string; health: string }> {
  const r = runCmd('docker', ['compose', 'ps', '--format', 'json'], POWERSYNC_DIR, 60_000);
  if (r.status !== 0) throw new Error(`docker compose ps failed: ${tail(r.stderr, 5)}`);
  let entries: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(r.stdout);
    entries = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    entries = r.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return null;
        }
      });
  }
  const out: Record<string, { state: string; health: string }> = {};
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const o = entry as Record<string, unknown>;
    const service = String(o.Service ?? o.service ?? '');
    if (service === '') continue;
    out[service] = {
      state: String(o.State ?? o.state ?? ''),
      health: String(o.Health ?? o.health ?? ''),
    };
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Step reporting
 * ------------------------------------------------------------------ */

interface StepReport {
  n: number;
  name: string;
  ok: boolean;
  ms: number;
  detail: string[];
}

const TOTAL_STEPS = 7;

function makeReporter() {
  const steps: StepReport[] = [];
  return {
    steps,
    async run(n: number, name: string, fn: () => Promise<string[]>): Promise<boolean> {
      const t0 = Date.now();
      try {
        const detail = (await fn()) ?? [];
        steps.push({ n, name, ok: true, ms: Date.now() - t0, detail });
        console.log(`[STEP ${n}/${TOTAL_STEPS}] ${name} ... PASS (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        for (const line of detail) console.log(`    ${line}`);
        return true;
      } catch (error) {
        steps.push({ n, name, ok: false, ms: Date.now() - t0, detail: [msg(error)] });
        console.error(`[STEP ${n}/${TOTAL_STEPS}] ${name} ... FAIL (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        console.error(`    ${msg(error).split('\n').join('\n    ')}`);
        return false;
      }
    },
  };
}

function printSummary(steps: StepReport[], totalMs: number): boolean {
  console.log('\n================ E2E SUMMARY ================');
  for (const s of steps) {
    console.log(`  ${s.ok ? 'PASS' : 'FAIL'}  [${s.n}/${TOTAL_STEPS}] ${s.name} (${(s.ms / 1000).toFixed(1)}s)`);
  }
  for (const s of steps) {
    if (!s.ok) {
      console.log(`\n  failure detail — step ${s.n} (${s.name}):`);
      for (const line of s.detail) console.log(`    ${line}`);
    }
  }
  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n  ${passed}/${TOTAL_STEPS} steps passed; total ${Math.round(totalMs / 1000)}s`);
  console.log('===========================================\n');
  return passed === TOTAL_STEPS;
}

/* ------------------------------------------------------------------ *
 * PowerSync client (first-party Node SDK)
 * ------------------------------------------------------------------ */

type PowersyncClient = Parameters<typeof wrapDb>[0];

interface NodePowersyncSdk {
  PowerSyncDatabase: new (options: {
    schema: unknown;
    logger: { log: (record: { level: number; message: string; error?: unknown }) => void };
    database: Record<string, unknown>;
  }) => PowersyncClient;
}

interface E2eClient {
  powersync: PowersyncClient;
  db: NextdoDb;
  sdkLog: string[];
}

let nodeSdk: NodePowersyncSdk | null = null;

/** Resolve @powersync/node through packages/db's node_modules (pnpm keeps
 *  it there — it is a devDependency of that package, and the repo root has
 *  no direct access to it). */
async function loadNodeSdk(): Promise<NodePowersyncSdk> {
  if (nodeSdk !== null) return nodeSdk;
  const requireFromDb = createRequire(join(REPO_ROOT, 'packages', 'db', 'package.json'));
  const sdkPath = requireFromDb.resolve('@powersync/node');
  nodeSdk = (await import(pathToFileURL(sdkPath).href)) as NodePowersyncSdk;
  return nodeSdk;
}

async function createClient(label: string, dbFilename: string, workDir: string): Promise<E2eClient> {
  const sdk = await loadNodeSdk();
  const sdkLog: string[] = [];
  const powersync = new sdk.PowerSyncDatabase({
    schema: AppSchema,
    logger: {
      log(record) {
        sdkLog.push(`[${label}] ${record.message}`);
        if (record.error !== undefined) sdkLog.push(`[${label}]   error: ${msg(record.error)}`);
      },
    },
    database: {
      dbFilename,
      dbLocation: workDir,
      // node:sqlite + the PowerSync C extension (the same engine mechanism
      // as packages/db/src/test/powersync-node.ts — the test harness cannot
      // be imported directly from here: it uses CJS `require.resolve` and
      // parameter properties, which do not work under Node ESM + type
      // stripping. Source of the pattern: that file.
      implementation: { type: 'node:sqlite' },
    },
  });
  await powersync.init();
  return { powersync, db: wrapDb(powersync), sdkLog };
}

/**
 * Connect + subscribe, exercising the 10-02 protocol change end to end.
 *
 * The connector is built with a DELIBERATELY WRONG local endpoint: if the
 * connector still preferred its injected config (the pre-10-02 behavior),
 * the SDK would try to reach the bogus URL and connect() would fail. It can
 * only succeed because /credentials handed back the deployment's real
 * `NEXTDO_SYNC_ENDPOINT` — a behavioral assertion of the whole chain
 * (boot env → /credentials body → fetchCredentialsOnce → connector).
 */
async function connectAndSubscribe(client: E2eClient, label: string): Promise<void> {
  const WRONG_LOCAL_ENDPOINT = 'http://127.0.0.1:9/wrong-endpoint';
  const connector = createPowerSyncConnector({
    backendUrl: BACKEND_URL,
    endpoint: WRONG_LOCAL_ENDPOINT,
  });
  const credentials = await connector.fetchCredentials();
  if (credentials === null) {
    throw new Error(`${label}: fetchCredentials returned null (no owner token stored?)`);
  }
  if (credentials.endpoint !== SERVICE_URL) {
    throw new Error(
      `${label}: connector did not adopt the server endpoint — got ${credentials.endpoint}, expected ${SERVICE_URL}`,
    );
  }
  await awaitWithTimeout(client.powersync.connect(connector), WAIT.connectMs, `${label}: connect()`);
  await awaitWithTimeout(
    client.powersync.waitForStatus(
      (s) => s.connected === true,
      AbortSignal.timeout(WAIT.connectMs),
    ),
    WAIT.connectMs + 5_000,
    `${label}: status "connected" (service accepted the minted JWT)`,
  );
  // Product code: subscribe to the single v1 stream (auto_subscribe on the
  // service side; this keeps the stream name in one place).
  await awaitWithTimeout(
    subscribeAppStream(client.powersync),
    30_000,
    `${label}: subscribe stream "${SYNC_STREAM_NAME}"`,
  );
}

function statusJson(powersync: PowersyncClient): string {
  try {
    const s = powersync.currentStatus;
    return JSON.stringify({
      connected: s.connected,
      connecting: s.connecting,
      hasSynced: s.hasSynced,
      lastSyncedAt: s.lastSyncedAt === undefined ? null : s.lastSyncedAt.toISOString(),
      downloading: s.downloading,
      uploading: s.uploading,
    });
  } catch (error) {
    return `status unavailable: ${msg(error)}`;
  }
}

/**
 * The ps_crud upload-queue depth for one table in the client's local DB.
 *
 * In the PowerSync v2 schema the `ps_crud` row has no `table_name` column —
 * the operation (including its target table) is serialized into the `data`
 * column as JSON: `{op, id, type: <table>, data: {...}}`. Verified against
 * the installed SDK (probe e2e/probe-ps-crud.ts, since deleted): the table
 * name lives at `$.type`.
 */
async function crudQueueDepth(powersync: PowersyncClient, tableName: string): Promise<number> {
  const result = await powersync.database.executeRaw(
    `SELECT count(*) FROM ps_crud WHERE json_extract(data, '$.type') = '${tableName}'`,
  );
  const first = result.rawRows?.[0]?.[0];
  return Number(first ?? 0);
}

/* ------------------------------------------------------------------ *
 * run — the verification protocol
 * ------------------------------------------------------------------ */

async function cmdRun(): Promise<boolean> {
  const startedAt = Date.now();
  const runId = `e2e-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;

  // Per-run isolation (AC7 idempotency): unique row ids via runId-tagged
  // titles + fresh tmp dir for client DB files + fresh secrets.
  const jwtSecret = randomBytes(32).toString('base64url');
  const ownerToken = `nextdo-owner-${randomBytes(24).toString('base64url')}`;
  const workDir = mkdtempSync(join(tmpdir(), `nextdo-e2e-${runId}-`));

  console.log(`== E2E sync round-trip (${runId}) ==`);
  console.log(`   repo:      ${REPO_ROOT}`);
  console.log(`   work dir:  ${workDir}`);

  const reporter = makeReporter();
  let serverProc: ChildProcess | null = null;
  let clientA: E2eClient | null = null;
  let clientB: E2eClient | null = null;
  let serverLogPath = '';

  const teardown = async (): Promise<void> => {
    for (const client of [clientB, clientA]) {
      if (client === null) continue;
      try {
        await awaitWithTimeout(client.powersync.close({ disconnect: true }), 10_000, 'close client');
      } catch (error) {
        console.error(`    cleanup: closing client failed: ${msg(error)}`);
      }
    }
    clientA = null;
    clientB = null;
    if (serverProc !== null) {
      try {
        serverProc.kill('SIGTERM');
        await awaitWithTimeout(
          new Promise<void>((r) => {
            serverProc?.once('exit', () => r());
            setTimeout(r, 5_000).unref?.();
          }),
          6_000,
          'stop server/app',
        );
      } catch {
        /* fall through to SIGKILL */
      }
      try {
        serverProc.kill('SIGKILL');
      } catch {
        /* already dead */
      }
      serverProc = null;
    }
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };

  // Ctrl-C / SIGTERM: tear down (server would otherwise be orphaned).
  let tearingDown = false;
  const onSignal = (signal: string): void => {
    if (tearingDown) return;
    tearingDown = true;
    console.error(`\n${signal} received — tearing down`);
    void teardown().finally(() => process.exit(130));
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  try {
    /* ---------------- Step 1: bootstrap ---------------- */
    const s1 = await reporter.run(1, 'bootstrap (docker stack + server/app)', async () => {
      const daemon = runCmd('docker', ['info'], REPO_ROOT, 30_000);
      if (daemon.status !== 0) {
        throw new Error(`Docker daemon unavailable: ${tail(daemon.stderr, 5)}`);
      }
      if (await portInUse(BACKEND_PORT)) {
        throw new Error(
          `port ${BACKEND_PORT} is already in use — stop the previous server/app instance first`,
        );
      }

      // PRD step 1: write both .env files (both gitignored).
      writeFileSync(
        join(POWERSYNC_DIR, '.env'),
        [
          'POSTGRES_USER=nextdo',
          'POSTGRES_PASSWORD=nextdo',
          'POSTGRES_DB=nextdo',
          `JWT_SECRET=${jwtSecret}`,
          'PS_ADMIN_TOKEN=nextdo-admin-dev',
          '',
        ].join('\n'),
      );
      writeFileSync(
        join(SERVER_APP_DIR, '.env'),
        [
          'DATABASE_URL=postgresql://nextdo:nextdo@localhost:5432/nextdo',
          `NEXTDO_OWNER_TOKEN=${ownerToken}`,
          // REQUIRED since 10-02-simplify-sync-setup: the backend refuses to
          // boot without it and hands it to clients via /credentials. In
          // this stack the clients reach the service directly on :8080, so
          // the loopback URL IS the reachable public URL.
          `NEXTDO_SYNC_ENDPOINT=${SERVICE_URL}`,
          `JWT_SECRET=${jwtSecret}`,
          'PORT=8787',
          '',
        ].join('\n'),
      );

      const pull = runCmd('docker', ['compose', 'pull'], POWERSYNC_DIR, WAIT.imagePullMs);
      if (pull.status !== 0) throw new Error(`docker compose pull failed:\n${tail(pull.stdout + pull.stderr)}`);

      const up = runCmd('docker', ['compose', 'up', '-d'], POWERSYNC_DIR, 5 * 60_000);
      if (up.status !== 0) throw new Error(`docker compose up failed:\n${tail(up.stdout + up.stderr)}`);

      const pgHealthy = await pollUntil(
        'postgres healthy',
        async () => {
          const services = composeServices();
          return services.postgres?.health === 'healthy' ? services.postgres : null;
        },
        WAIT.stackHealthyMs,
        2_000,
      );
      void pgHealthy;

      // PowerSync service readiness: the official health probe is
      // /probes/liveness (per self-host-demo). If the container crashes on
      // boot (bad config, bad env), fail FAST with its logs instead of
      // waiting out the whole deadline.
      let serviceReadyDetail = '';
      {
        const deadline = Date.now() + WAIT.serviceReadyMs;
        for (;;) {
          const ps = composeServices().powersync;
          if (ps !== undefined && (ps.state === 'exited' || ps.state === 'dead')) {
            const logs = runCmd('docker', ['compose', 'logs', '--tail', '20', 'powersync'], POWERSYNC_DIR, 30_000);
            throw new Error(`powersync container ${ps.state} — service logs:\n${tail(logs.stdout + logs.stderr, 20)}`);
          }
          try {
            const res = await fetch(`${SERVICE_URL}/probes/liveness`, { signal: AbortSignal.timeout(3_000) });
            if (res.ok) {
              serviceReadyDetail = `/probes/liveness -> ${res.status}`;
              break;
            }
          } catch {
            /* service not up yet */
          }
          if (Date.now() >= deadline) {
            throw new Error(
              `timed out after ${WAIT.serviceReadyMs}ms waiting for powersync service ready (container state: ${ps?.state ?? 'missing'})`,
            );
          }
          await sleep(2_000);
        }
      }

      const build = runCmd('pnpm', ['--filter', '@nextdo/server', 'build'], REPO_ROOT, WAIT.serverBuildMs);
      if (build.status !== 0) {
        throw new Error(`server/app build failed:\n${tail(build.stdout + build.stderr)}`);
      }

      serverLogPath = join(workDir, 'server-app.log');
      const out = openSync(serverLogPath, 'a');
      serverProc = spawn(process.execPath, [join(SERVER_APP_DIR, 'dist', 'index.js')], {
        cwd: SERVER_APP_DIR,
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://nextdo:nextdo@localhost:5432/nextdo',
          NEXTDO_OWNER_TOKEN: ownerToken,
          // Also passed explicitly (not only via the .env file above) so the
          // spawned process cannot miss it if the file write is ever skipped.
          NEXTDO_SYNC_ENDPOINT: SERVICE_URL,
          JWT_SECRET: jwtSecret,
          PORT: String(BACKEND_PORT),
        },
        stdio: ['ignore', out, out],
      });
      serverProc.unref?.();

      await pollUntil(
        `server/app answering on :${BACKEND_PORT}`,
        async () => {
          try {
            const res = await fetch(`${BACKEND_URL}/credentials`, { signal: AbortSignal.timeout(1_500) });
            // 401 without a token is the server being UP (auth matrix).
            return res.status === 401 || res.status === 200 ? `GET /credentials -> ${res.status}` : null;
          } catch {
            return null;
          }
        },
        WAIT.serverUpMs,
        500,
      );

      return [
        'docker stack: postgres healthy, powersync service running (journeyapps/powersync-service:1.26.1)',
        'secrets: fresh base64url JWT_SECRET + random NEXTDO_OWNER_TOKEN written to server/powersync/.env and server/app/.env (gitignored)',
        'server/app: built via pnpm --filter @nextdo/server build, running on :8787 against real Postgres (log: server-app.log in work dir)',
      ];
    });
    if (!s1) return printSummary(reporter.steps, Date.now() - startedAt);

    /* ---------------- Step 2: auth negatives (AC3) ---------------- */
    const s2 = await reporter.run(2, 'auth negatives: /credentials + /upload × (missing, wrong) token', async () => {
      const cases: Array<{ label: string; path: string; init: RequestInit }> = [
        { label: 'GET /credentials, no token', path: '/credentials', init: {} },
        { label: 'GET /credentials, wrong token', path: '/credentials', init: { headers: { Authorization: `Bearer ${ownerToken}-WRONG` } } },
        { label: 'POST /upload, no token', path: '/upload', init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: [] }) } },
        { label: 'POST /upload, wrong token', path: '/upload', init: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}-WRONG` }, body: JSON.stringify({ ops: [] }) } },
      ];
      const detail: string[] = [];
      for (const c of cases) {
        const res = await fetch(`${BACKEND_URL}${c.path}`, c.init);
        if (res.status !== 401) throw new Error(`${c.label}: expected 401, got ${res.status}`);
        detail.push(`${c.label} -> 401`);
        await res.body?.cancel();
      }
      return detail;
    });
    if (!s2) return printSummary(reporter.steps, Date.now() - startedAt);

    /* ---------------- Step 3: JWT accepted by the service (AC2) ---------------- */
    const s3 = await reporter.run(3, 'JWT accepted: client A connects + subscribes stream "all"', async () => {
      // PRD: in-memory owner-token store via the product test hook.
      const memoryStore = new Map<string, string>();
      __setStorageBackendForTests({
        getItem: async (key) => memoryStore.get(key) ?? null,
        setItem: async (key, value) => void memoryStore.set(key, value),
        removeItem: async (key) => void memoryStore.delete(key),
      });
      await setOwnerToken(ownerToken);

      clientA = await createClient('A', 'nextdo-a.db', workDir);
      await connectAndSubscribe(clientA, 'A');
      return [
        `GET /credentials with owner token -> 200 {token, endpoint} (the connector's fetchCredentials)`,
        `client A: fetchCredentials returned endpoint=${SERVICE_URL} — the server's NEXTDO_SYNC_ENDPOINT won over the locally injected value`,
        `client A: connect() ok, status "connected" — the PowerSync Service accepted the minted 15-min JWT (kid nextdo-dev, aud nextdo)`,
        `client A: subscribed to stream "${SYNC_STREAM_NAME}"`,
        `client A status: ${statusJson(clientA.powersync)}`,
      ];
    });
    if (!s3) {
      if (clientA !== null) dumpSdkLog(clientA);
      return printSummary(reporter.steps, Date.now() - startedAt);
    }

    /* ---------------- Step 4: read path (AC4) ---------------- */
    const seededId = ulid(new Date());
    const seededTitle = `E2E seeded ${runId}`;
    const nowIso = new Date().toISOString();
    const s4 = await reporter.run(4, 'read path: row seeded directly in Postgres reaches client A', async () => {
      psql(
        `INSERT INTO next_actions (id, created_at, updated_at, title, status, est_minutes, value, category, context_ids) ` +
          `VALUES ('${seededId}', '${nowIso}', '${nowIso}', '${seededTitle}', 'open', 15, 3, 'work', '[]')`,
      );

      const row = await pollUntil(
        `client A local copy of seeded row ${seededId}`,
        async () => {
          const rows = await clientA!.db
            .selectFrom('next_actions')
            .selectAll()
            .where('id', '=', seededId)
            .execute();
          return rows.length === 1 ? rows[0] : null;
        },
        WAIT.readPathMs,
      );
      if (row.title !== seededTitle || row.status !== 'open' || row.est_minutes !== 15 || row.value !== 3) {
        throw new Error(`seeded row field mismatch locally: ${JSON.stringify(row)}`);
      }
      return [
        `Postgres: INSERT next_actions id=${seededId} title="${seededTitle}"`,
        `client A local kysely query sees it: title/status/est_minutes/value all match (Postgres -> PowerSync Service -> client A local SQLite)`,
      ];
    });
    if (!s4) {
      if (clientA !== null) dumpSdkLog(clientA);
      return printSummary(reporter.steps, Date.now() - startedAt);
    }

    /* ---------------- Step 5: write path (AC5 + append-only 2xx) ---------------- */
    const writtenId = ulid(new Date());
    const writtenTitle = `E2E uploaded ${runId}`;
    const reviewId = ulid(new Date());
    const reviewAt = new Date().toISOString();
    const reviewSnapshot =
      '{"inboxCount":1,"completedToday":[],"stillOpen":[],"projectsMissingActions":[],"waitingFollowUps":[],"calendarToday":[],"calendarTomorrow":[],"repeatedSkips":[]}';
    const reviewPatchedSnapshot = `{"patched":true,${reviewSnapshot.slice(1)}`;
    const s5 = await reporter.run(5, 'write path: local INSERT -> /upload -> Postgres (+ append-only PATCH 2xx)', async () => {
      // 5a: local INSERT on a synced table (product row shape — explicit
      // client-minted ULID, like every packages/db mutation).
      await clientA!.db
        .insertInto('next_actions')
        .values({
          id: writtenId,
          created_at: nowIso,
          updated_at: nowIso,
          title: writtenTitle,
          status: 'open',
          est_minutes: 25,
          value: 4,
          category: 'work',
          context_ids: '[]',
        })
        .execute();

      const pgRow = await pollUntil(
        `row ${writtenId} in Postgres via /upload`,
        async () => {
          const out = psql(
            `SELECT title, status, est_minutes, value, category FROM next_actions WHERE id = '${writtenId}'`,
          );
          return out === '' ? null : out.split('|');
        },
        WAIT.writePathMs,
      );
      const [pgTitle, pgStatus, pgEst, pgValue, pgCategory] = pgRow;
      if (pgTitle !== writtenTitle || pgStatus !== 'open' || pgEst !== '25' || pgValue !== '4' || pgCategory !== 'work') {
        throw new Error(`Postgres row field mismatch after upload: ${pgRow.join(' | ')}`);
      }

      // 5b: append-only table — PUT lands, PATCH is rejected but 2xx.
      await clientA!.db
        .insertInto('review_records')
        .values({
          id: reviewId,
          created_at: reviewAt,
          updated_at: reviewAt,
          kind: 'daily',
          at: reviewAt,
          snapshot: reviewSnapshot,
          answers: '{"completedActionIds":[],"rescheduled":[],"skippedNoted":[],"tomorrowMustDo":[]}',
        })
        .execute();
      await pollUntil(
        `review_records row ${reviewId} in Postgres`,
        async () => (psql(`SELECT 1 FROM review_records WHERE id = '${reviewId}'`) === '1' ? true : null),
        WAIT.writePathMs,
      );

      // Local UPDATE -> INSTEAD-OF trigger enqueues a PATCH op -> SDK
      // uploadData -> /upload answers 2xx (rejection in body) -> the queue
      // advances. A non-2xx would block the queue, so "queue drained" is
      // the end-to-end proof of the 2xx-on-rejection protocol.
      await clientA!.db
        .updateTable('review_records')
        .set({ snapshot: reviewPatchedSnapshot, updated_at: new Date().toISOString() })
        .where('id', '=', reviewId)
        .execute();
      await pollUntil(
        `ps_crud queue drained for review_records (PATCH answered 2xx)`,
        async () => (await crudQueueDepth(clientA!.powersync, 'review_records')) === 0 ? true : null,
        WAIT.queueDrainMs,
      );
      const pgSnapshot = psql(`SELECT snapshot FROM review_records WHERE id = '${reviewId}'`);
      if (pgSnapshot !== reviewSnapshot) {
        throw new Error(`append-only row was modified in Postgres: ${pgSnapshot.slice(0, 120)}`);
      }
      return [
        `client A local INSERT next_actions id=${writtenId} -> SDK ps_crud queue -> uploadData -> POST /upload -> Postgres (title/status/est_minutes/value/category all match)`,
        `append-only: local PUT review_records id=${reviewId} landed in Postgres; local PATCH was rejected at the endpoint but answered 2xx (queue drained) and the Postgres snapshot is unchanged`,
      ];
    });
    if (!s5) {
      if (clientA !== null) dumpSdkLog(clientA);
      return printSummary(reporter.steps, Date.now() - startedAt);
    }

    /* ---------------- Step 6: cross-client (AC6) ---------------- */
    const s6 = await reporter.run(6, 'cross-client: fresh client B sees the step 4 + 5 rows', async () => {
      clientB = await createClient('B', 'nextdo-b.db', workDir);
      await connectAndSubscribe(clientB, 'B');

      const rows = await pollUntil(
        'client B local copies of both rows',
        async () => {
          const a = await clientB!.db
            .selectFrom('next_actions')
            .selectAll()
            .where('id', 'in', [seededId, writtenId])
            .execute();
          return a.length === 2 ? a : null;
        },
        WAIT.crossClientMs,
      );
      for (const row of rows) {
        if (row.id === seededId && row.title !== seededTitle) {
          throw new Error(`client B seeded row mismatch: ${JSON.stringify(row)}`);
        }
        if (row.id === writtenId && row.title !== writtenTitle) {
          throw new Error(`client B uploaded row mismatch: ${JSON.stringify(row)}`);
        }
      }
      const reviewRows = await clientB!.db
        .selectFrom('review_records')
        .select('id')
        .where('id', '=', reviewId)
        .execute();
      return [
        `client B (fresh DB file ${workDir}/nextdo-b.db, same owner token) connected + subscribed`,
        `client B local: both next_actions rows present — seeded (${seededId}) and uploaded (${writtenId})`,
        reviewRows.length === 1
          ? 'client B local: review_records row also present (append-only PUT replicated)'
          : 'note: review_records row not yet visible on client B (not part of the AC6 assertion)',
      ];
    });
    if (!s6) {
      if (clientB !== null) dumpSdkLog(clientB);
      if (clientA !== null) dumpSdkLog(clientA);
      return printSummary(reporter.steps, Date.now() - startedAt);
    }

    /* ---------------- Step 7: cleanup ---------------- */
    const s7 = await reporter.run(7, 'cleanup (clients disconnected, server/app stopped)', async () => {
      // Capture the server log BEFORE the work dir is removed by teardown.
      let serverLogTail = '';
      try {
        if (existsSync(serverLogPath)) {
          serverLogTail = tail(readFileSync(serverLogPath, 'utf8').trim(), 12);
        }
      } catch {
        /* log capture is best-effort */
      }
      await teardown();
      const stillUp = await portInUse(BACKEND_PORT);
      if (stillUp) throw new Error(`server/app still answering on :${BACKEND_PORT} after teardown`);
      return [
        'client A + B closed; server/app process stopped (port :8787 free again)',
        `docker stack LEFT RUNNING (postgres :5432, powersync :8080) — tear down with: node e2e/sync-roundtrip.ts down`,
        `work dir removed: ${workDir}`,
        `server/app log tail:\n${serverLogTail.split('\n').join('\n') || '(empty)'}`,
      ];
    });
    if (!s7) return printSummary(reporter.steps, Date.now() - startedAt);

    return printSummary(reporter.steps, Date.now() - startedAt);
  } finally {
    await teardown();
  }
}

function dumpSdkLog(client: E2eClient): void {
  console.error('    --- PowerSync SDK log (last 40 lines) ---');
  for (const line of client.sdkLog.slice(-40)) console.error(`    ${line}`);
}

/* ------------------------------------------------------------------ *
 * down — tear the docker stack down
 * ------------------------------------------------------------------ */

async function cmdDown(): Promise<boolean> {
  console.log('== E2E sync round-trip: down ==');
  const r = runCmd('docker', ['compose', 'down'], POWERSYNC_DIR, 5 * 60_000);
  if (r.status !== 0) {
    console.error(`docker compose down failed:\n${tail(r.stdout + r.stderr)}`);
    return false;
  }
  console.log(tail(r.stdout, 10));
  console.log('docker stack stopped.');
  return true;
}

/* ------------------------------------------------------------------ *
 * Entry
 * ------------------------------------------------------------------ */

export async function main(args: string[]): Promise<boolean> {
  const command = args[0] ?? 'run';
  if (command === 'down') {
    if (!existsSync(join(POWERSYNC_DIR, 'docker-compose.yml'))) {
      console.error(`no docker-compose.yml in ${POWERSYNC_DIR}`);
      return false;
    }
    return cmdDown();
  }
  if (command === 'run') return cmdRun();
  console.error(`unknown command: ${command} (usage: node e2e/sync-roundtrip.ts [run|down])`);
  return false;
}
