/**
 * Sync-endpoint boot resolution — the ONE source of truth for the
 * PowerSync stream address is the `NEXTDO_SYNC_ENDPOINT` environment
 * variable (deploy-owned): the deployment already decides the public
 * path layout (`/sync`, a subdomain, …), so the endpoint is configured
 * ONCE there and handed to every device through `GET /credentials`.
 * Clients still carry their own copy in `nextdo.sync.config` (the
 * offline / old-server fallback), so nothing about the wire protocol
 * depends on the device guessing a path.
 *
 * Contract (mirrors resolveOwnerToken's style):
 *   - non-empty after trim AND an absolute http(s) URL → returned as the
 *     process's immutable endpoint;
 *   - missing / empty / whitespace-only / non-absolute / non-http(s) →
 *     THROW, so the boot refuses instead of advertising a path the
 *     PowerSync service does not serve.
 *
 * Deliberate: NO auto-derivation fallback from NEXTDO_SYNC_ENDPOINT's
 * absence. A silently derived-but-wrong path produces a client that
 * "connects" and never syncs — far harder to diagnose than a refused
 * boot. The deployer sets it once.
 */

export interface SyncEndpointEnv {
  NEXTDO_SYNC_ENDPOINT?: string;
}

/**
 * Resolve the sync endpoint for this boot. Synchronous and
 * side-effect-free (env-only). Throws when the value is missing, empty
 * or not an absolute http(s) URL, so the boot is refused.
 */
export function resolveSyncEndpoint(env: SyncEndpointEnv = process.env): string {
  const raw = env.NEXTDO_SYNC_ENDPOINT?.trim();
  if (raw === undefined || raw === '') {
    throw new Error(
      'NEXTDO_SYNC_ENDPOINT is not set — set it in server/deploy/.env to the public sync-stream URL clients use (e.g. https://your.domain/sync)',
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `NEXTDO_SYNC_ENDPOINT is not an absolute URL: ${raw} — expected something like https://your.domain/sync`,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `NEXTDO_SYNC_ENDPOINT must be an http(s) URL: ${raw} — expected something like https://your.domain/sync`,
    );
  }
  return raw;
}