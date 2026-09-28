/**
 * App-level runtime configuration (design.md §4: `lib/env.ts`).
 *
 * The OSS default is PURE LOCAL: an open-source build must not point at any
 * particular server, so the sync-server addresses are NO LONGE held here.
 * Both the owner token and the per-device sync config (`{ backendUrl,
 * endpoint }`) live in `packages/db`'s owner-token module (per-platform
 * storage matrix: SecureStore / Stronghold / in-memory); the user enters
 * them in the Settings tab (cloud sync is OPTIONAL — R6). This file keeps
 * only the platform-fixed web worker path below.
 *
 * No env-var fallback anywhere (spec: app/database-guidelines.md — client
 * env values may end up in the build output).
 */

/**
 * Where the @powersync/web worker asset is served from (web / Tauri only).
 * The asset is a committed copy of `node_modules/@powersync/web/dist/worker`
 * in `apps/mobile/public/@powersync/` (copied via `npx @powersync/web
 * copy-assets` — see research/versions-powersync.md). The web bundle serves
 * `public/` at its root, so the path is absolute from the web root.
 */
export const POWERSYNC_WEB_WORKER_PATH = '/@powersync/worker.js';
