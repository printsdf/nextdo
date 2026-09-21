/**
 * App-level runtime configuration (design.md §4: `lib/env.ts` — backend URL /
 * owner-token access, platform-aware).
 *
 * No env-var fallback anywhere (spec: app/database-guidelines.md — client env
 * values may end up in the build output). The values are:
 * - dev defaults for a local backend (`server/app`) and PowerSync Service
 *   (`server/powersync`) — replaceable at runtime via `configureBackend`
 *   (the settings screen, a later task, writes the user's values here);
 * - the owner token itself is NOT stored here — it lives in `packages/db`'s
 *   owner-token module (per-platform storage matrix).
 */
import type { NextdoPowerSyncConfig } from '@nextdo/db';

/** Dev defaults: local backend + local PowerSync Service. */
const DEV_BACKEND: NextdoPowerSyncConfig = {
  backendUrl: 'http://localhost:3000',
  endpoint: 'http://localhost:8080',
};

let backend: NextdoPowerSyncConfig = DEV_BACKEND;

/** The backend config the connector uses (`/credentials` + `/upload`). */
export function getBackendConfig(): NextdoPowerSyncConfig {
  return backend;
}

/** Replace the backend config at runtime (settings screen, later task). */
export function configureBackend(config: NextdoPowerSyncConfig): void {
  backend = config;
}

/**
 * Where the @powersync/web worker asset is served from (web / Tauri only).
 * The asset is a committed copy of `node_modules/@powersync/web/dist/worker`
 * in `apps/mobile/public/@powersync/` (copied via `npx @powersync/web
 * copy-assets` — see research/versions-powersync.md). The web bundle serves
 * `public/` at its root, so the path is absolute from the web root.
 */
export const POWERSYNC_WEB_WORKER_PATH = '/@powersync/worker.js';
