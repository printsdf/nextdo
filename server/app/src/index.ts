/**
 * @nextdo/server — process entry: `node dist/index.js` (Dockerfile CMD /
 * `pnpm start`). Reads the environment, opens the pg pool, and serves the
 * Hono app from src/app.ts on :PORT (default 8787).
 *
 * The app (createApp, the /credentials + /upload routes) lives in
 * src/app.ts WITHOUT side effects; this file is the only module that
 * self-starts. The import.meta entry-point check below keeps that true —
 * and, as a consequence, NO other file in this package uses import.meta,
 * so the jest suite (which imports src/app.ts directly) never has to parse
 * it (babel compiles to CJS, where import.meta is a parse-time SyntaxError).
 *
 * @nextdo/server is the PowerSync protocol boundary and imports NOTHING
 * from the monorepo (spec: project/directory-structure.md Rule 1).
 */
import { serve } from '@hono/node-server';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import {
  initSystemSettingsTable,
  readPersistedOwnerToken,
  ServerClaimManager,
} from './claim.js';
import { createPool } from './db.js';
import { logger } from './logger.js';
import { resolveStaticOwnerToken } from './owner-token.js';
import { initDatabaseSchema } from './schema-init.js';
import { seedDefaultContexts } from './seed.js';
import { resolveSyncEndpoint } from './sync-endpoint.js';

/** Read the environment, open the pool, initialize claim management, and serve. */
export async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL is not set');
  }

  const staticOwnerToken = resolveStaticOwnerToken();
  if (staticOwnerToken !== null) {
    logger.info('owner token source: env');
  } else {
    logger.info('owner token source: claimable / database');
  }

  if (jwtSecret === undefined || jwtSecret === '') {
    throw new Error('JWT_SECRET is not set');
  }
  // REQUIRED and env-only: the public sync-stream URL every device receives from /credentials.
  const syncEndpoint = resolveSyncEndpoint();
  logger.info('sync endpoint source: env');
  const portRaw = process.env.PORT;
  const port = portRaw === undefined ? 8787 : Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT is not a valid port: ${portRaw}`);
  }

  const pool = createPool(databaseUrl);

  // Auto-initialize application database schema (tables, indexes, publication)
  try {
    await initDatabaseSchema(pool);
  } catch (error) {
    logger.error('failed to initialize database schema', error);
  }

  // Initialize system_settings table and resolve claim state
  try {
    await initSystemSettingsTable(pool);
  } catch (error) {
    logger.error('failed to initialize system_settings table', error);
  }

  let initialDynamicToken: string | null = null;
  if (staticOwnerToken === null) {
    try {
      initialDynamicToken = await readPersistedOwnerToken(pool);
    } catch (error) {
      logger.error('failed to read persisted owner token', error);
    }
  }

  const claimState = new ServerClaimManager({
    pool,
    staticToken: staticOwnerToken,
    initialDynamicToken,
  });

  // Seed default contexts on a fresh database
  try {
    await seedDefaultContexts(pool);
  } catch (error) {
    logger.error('context seeding failed', error);
  }

  const claimSecret = process.env.NEXTDO_CLAIM_SECRET?.trim() || null;
  if (claimSecret !== null) {
    logger.info('claim secret: configured');
  }

  const app = createApp({
    pool,
    claimState,
    claimSecret,
    jwtSecret,
    syncEndpoint,
  });
  serve({ fetch: app.fetch, port }, (info) => {
    logger.info(`listening on :${info.port}`);
  });
}

/** True when this file is the process entry point (`node dist/index.js`). */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

/* Node entry — `node dist/index.js` (Dockerfile CMD / pnpm start). The
 * check keeps the app importable without starting the server. */
if (isDirectRun()) {
  main().catch((error: unknown) => {
    logger.error('failed to start', error);
    process.exitCode = 1;
  });
}
