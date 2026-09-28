/**
 * Owner-token bootstrap (prod-deploy R7) — the resolution order
 * (explicit env > persisted file > first-run auto-generation), the
 * 64-hex shape, the silent-reuse contract (restart ≠ first run: no
 * regeneration, no re-print), and the one-time banner.
 *
 * Each test gets a fresh temp dir; the module takes the file path from
 * the env record, so there is no global state to reset.
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveOwnerToken } from '../src/owner-token.js';
import { logger } from '../src/logger.js';

let dir: string;
let tokenFile: string;
let infoSpy: jest.SpyInstance;

function envRecord(overrides: Record<string, string> = {}): Record<string, string> {
  return { NEXTDO_OWNER_TOKEN_FILE: tokenFile, ...overrides };
}

/** All banner lines emitted so far (joined for substring asserts). */
function loggedText(): string {
  return infoSpy.mock.calls.map((call) => String(call[0])).join('\n');
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'nextdo-owner-token-'));
  tokenFile = path.join(dir, 'data', 'owner-token');
  infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
});

afterEach(async () => {
  infoSpy.mockRestore();
  await rm(dir, { recursive: true, force: true });
});

describe('resolveOwnerToken', () => {
  it('explicit NEXTDO_OWNER_TOKEN wins — nothing written, nothing printed', async () => {
    const resolution = await resolveOwnerToken(
      envRecord({ NEXTDO_OWNER_TOKEN: 'env-token' }),
    );
    expect(resolution).toEqual({ token: 'env-token', source: 'env' });
    await expect(stat(tokenFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(loggedText()).not.toContain('env-token');
  });

  it('an empty NEXTDO_OWNER_TOKEN is treated as unset (compose passes "" when .env leaves it blank)', async () => {
    const resolution = await resolveOwnerToken(
      envRecord({ NEXTDO_OWNER_TOKEN: '' }),
    );
    expect(resolution.source).toBe('generated');
  });

  it('no env + no file → generates a 64-hex token, persists it, prints the banner ONCE', async () => {
    const resolution = await resolveOwnerToken(envRecord());
    expect(resolution.source).toBe('generated');
    expect(resolution.token).toMatch(/^[0-9a-f]{64}$/);
    expect((await readFile(tokenFile, 'utf8')).trim()).toBe(resolution.token);
    // The banner is the token's only display path — and it ran exactly once.
    const occurrences = loggedText().split(resolution.token).length - 1;
    expect(occurrences).toBe(1);
    expect(loggedText()).toContain('shown ONCE');
  });

  it('an existing non-empty file is reused SILENTLY — no regeneration, no re-print', async () => {
    await mkdir(path.dirname(tokenFile), { recursive: true });
    await writeFile(tokenFile, 'stored-token-from-earlier-first-run\n', 'utf8');

    const resolution = await resolveOwnerToken(envRecord());
    expect(resolution).toEqual({
      token: 'stored-token-from-earlier-first-run',
      source: 'file',
    });
    expect(loggedText()).not.toContain('stored-token-from-earlier-first-run');
  });

  it('a whitespace-only file is a failed first run → regenerates', async () => {
    await mkdir(path.dirname(tokenFile), { recursive: true });
    await writeFile(tokenFile, '   \n', 'utf8');

    const resolution = await resolveOwnerToken(envRecord());
    expect(resolution.source).toBe('generated');
    expect(resolution.token).toMatch(/^[0-9a-f]{64}$/);
    expect((await readFile(tokenFile, 'utf8')).trim()).toBe(resolution.token);
  });

  it('two boots against the same file keep the same token (restart ≠ rotation)', async () => {
    const first = await resolveOwnerToken(envRecord());
    const second = await resolveOwnerToken(envRecord());
    expect(first.source).toBe('generated');
    expect(second.source).toBe('file');
    expect(second.token).toBe(first.token);
  });
});
