/**
 * App-level runtime configuration (design.md §4: `lib/env.ts` — the single
 * config point for the backend URLs, shared by phone and desktop).
 *
 * No env-var fallback anywhere (spec: app/database-guidelines.md — client env
 * values may end up in the build output). The values are:
 * - the production backend URLs below (prod-deploy R2): after the user
 *   deploys the stack under their own domain they fill these in ONCE —
 *   the placeholder `REPLACE-WITH-YOUR-DOMAIN` marks the not-yet-deployed
 *   state;
 * - the owner token itself is NOT stored here — it lives in `packages/db`'s
 *   owner-token module (per-platform storage matrix), entered by the user
 *   in the ConnectGate.
 *
 * `configureBackend` is retained as a TEST SEAM ONLY (unit tests + the
 * local e2e harness inject their own constants; app code never calls it).
 */
import type { NextdoPowerSyncConfig } from '@nextdo/db';

// 生产配置 — 部署后填一次（手机/桌面共用；本地 e2e 用 e2e/run.ts 自有常量，不受影响）
const BACKEND: NextdoPowerSyncConfig = {
  backendUrl: 'https://REPLACE-WITH-YOUR-DOMAIN/api',
  endpoint: 'https://REPLACE-WITH-YOUR-DOMAIN/sync',
};

let backend: NextdoPowerSyncConfig = BACKEND;

/** The backend config the connector uses (`/credentials` + `/upload`). */
export function getBackendConfig(): NextdoPowerSyncConfig {
  return backend;
}

/** Test seam: replace the backend config (never called from app code). */
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
