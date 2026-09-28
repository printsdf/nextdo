/**
 * Owner-token boot resolution (deploy-owned token): the ONLY source is
 * `NEXTDO_OWNER_TOKEN`. A non-empty value (after trim) is returned as the
 * process's immutable token; a missing / empty / whitespace-only value
 * refuses the boot with an actionable error that names the generation
 * command (`openssl rand -hex 32`) and the .env location.
 *
 * The module has no logging at all — the token can never reach a log line.
 * The function is synchronous and side-effect-free (env-only: the file
 * path is gone), so no temp dirs or spies are needed.
 */
import { resolveOwnerToken } from '../src/owner-token.js';

describe('resolveOwnerToken', () => {
  it('a non-empty NEXTDO_OWNER_TOKEN is returned as-is', () => {
    expect(resolveOwnerToken({ NEXTDO_OWNER_TOKEN: 'env-token' })).toBe('env-token');
  });

  it('surrounding whitespace is trimmed off the returned token', () => {
    expect(resolveOwnerToken({ NEXTDO_OWNER_TOKEN: '  env-token  ' })).toBe('env-token');
  });

  it.each([
    ['an empty string', { NEXTDO_OWNER_TOKEN: '' }],
    ['a whitespace-only value', { NEXTDO_OWNER_TOKEN: '   ' }],
    ['an unset variable', {}],
  ])('missing/empty NEXTDO_OWNER_TOKEN (%s) refuses the boot with the generation command', (
    _label,
    env,
  ) => {
    expect(() => resolveOwnerToken(env)).toThrow(/openssl rand -hex 32/);
    expect(() => resolveOwnerToken(env)).toThrow(/server\/deploy\/\.env/);
  });
});
