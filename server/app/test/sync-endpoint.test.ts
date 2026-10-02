/**
 * Sync-endpoint boot resolution (10-02-simplify-sync-setup): the public
 * PowerSync stream URL comes ONLY from `NEXTDO_SYNC_ENDPOINT`. A
 * non-empty absolute http(s) value is returned verbatim; missing / empty
 * / whitespace-only / relative / non-http(s) values refuse the boot with
 * an actionable error naming the variable and the expected shape.
 *
 * Deliberately NO auto-derivation fallback: a silently derived-but-wrong
 * path yields clients that "connect" and never sync — much harder to
 * diagnose than a refused boot (design D4).
 *
 * The module has no logging at all and is synchronous + side-effect-free
 * (env-only), so no temp dirs or spies are needed.
 */
import { resolveSyncEndpoint } from '../src/sync-endpoint.js';

describe('resolveSyncEndpoint', () => {
  it('a valid NEXTDO_SYNC_ENDPOINT is returned as-is', () => {
    expect(resolveSyncEndpoint({ NEXTDO_SYNC_ENDPOINT: 'https://your.domain/sync' })).toBe(
      'https://your.domain/sync',
    );
  });

  it('surrounding whitespace is trimmed off the returned endpoint', () => {
    expect(resolveSyncEndpoint({ NEXTDO_SYNC_ENDPOINT: '  https://your.domain/sync\n' })).toBe(
      'https://your.domain/sync',
    );
  });

  it('a plain http:// endpoint (a LAN / loopback deployment) is accepted', () => {
    expect(resolveSyncEndpoint({ NEXTDO_SYNC_ENDPOINT: 'http://localhost:8080' })).toBe(
      'http://localhost:8080',
    );
  });

  it('an endpoint with no /sync suffix (a subdomain deployment) is kept verbatim', () => {
    expect(resolveSyncEndpoint({ NEXTDO_SYNC_ENDPOINT: 'https://sync.your.domain' })).toBe(
      'https://sync.your.domain',
    );
  });

  it.each([
    ['an empty string', { NEXTDO_SYNC_ENDPOINT: '' }],
    ['a whitespace-only value', { NEXTDO_SYNC_ENDPOINT: '   ' }],
    ['an unset variable', {}],
  ])('missing/empty NEXTDO_SYNC_ENDPOINT (%s) refuses the boot and names the variable', (
    _label,
    env,
  ) => {
    expect(() => resolveSyncEndpoint(env)).toThrow(/NEXTDO_SYNC_ENDPOINT is not set/);
    expect(() => resolveSyncEndpoint(env)).toThrow(/server\/deploy\/\.env/);
  });

  it.each([
    ['a relative path', '/sync'],
    ['a bare host with no scheme', 'your.domain/sync'],
  ])('a non-absolute URL (%s) refuses the boot', (_label, value) => {
    expect(() => resolveSyncEndpoint({ NEXTDO_SYNC_ENDPOINT: value })).toThrow(
      /NEXTDO_SYNC_ENDPOINT is not an absolute URL/,
    );
  });

  it.each([
    ['ftp://', 'ftp://your.domain/sync'],
    ['ws://', 'ws://your.domain/sync'],
  ])('a non-http(s) scheme (%s) refuses the boot', (_label, value) => {
    expect(() => resolveSyncEndpoint({ NEXTDO_SYNC_ENDPOINT: value })).toThrow(
      /NEXTDO_SYNC_ENDPOINT must be an http\(s\) URL/,
    );
  });
});