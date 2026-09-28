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
import { createPool } from './db.js';
import { logger } from './logger.js';
import { resolveOwnerToken } from './owner-token.js';
import { seedDefaultContexts } from './seed.js';

/** Read the environment, refuse to boot on a missing secret, serve.
 *  (The owner token may also resolve to UNCLAIMED at boot — the first
 *  device's POST /claim then mints it; see src/owner-token.ts.) */
export async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL is not set');
  }
  // Claim task 09-28: explicit env > persisted file > UNCLAIMED (token
  // null — nothing is generated or printed at boot; the token never
  // reaches a log line, the claim's 200 body is its only display path).
  const { token: ownerToken, source: ownerTokenSource } = await resolveOwnerToken();
  if (ownerTokenSource === 'unclaimed') {
    logger.info(
      'owner token unclaimed — first device to POST /claim mints it (or set NEXTDO_OWNER_TOKEN)',
    );
  } else {
    logger.info(`owner token source: ${ownerTokenSource}`);
  }
  if (jwtSecret === undefined || jwtSecret === '') {
    throw new Error('JWT_SECRET is not set');
  }
  const portRaw = process.env.PORT;
  const port = portRaw === undefined ? 8787 : Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT is not a valid port: ${portRaw}`);
  }

  const pool = createPool(databaseUrl);
  // Seed the default contexts on a FRESH database (domain-model.md "Context").
  // SINGLE-WRITER (the server entry) — it cannot race the way client-side
  // seeding did (two fresh clients seeding two sets of defaults). No-op when
  // the table already holds any row. Non-fatal: a seed failure must not block
  // startup — the user can create contexts in the UI, and the next boot retries.
  try {
    await seedDefaultContexts(pool);
  } catch (error) {
    logger.error('context seeding failed', error);
  }
  const app = createApp({ pool, ownerToken, ownerTokenSource, jwtSecret });
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
