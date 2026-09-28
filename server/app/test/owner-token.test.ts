/**
 * Owner-token bootstrap + one-time claim (prod-deploy R7, claim task
 * 09-28) — the resolution order (explicit env > persisted file >
 * UNCLAIMED: token null, no file written, no log line), the 64-hex shape
 * of the claimed token, the silent-reuse contract (restart ≠ claim), and
 * the claim's three states (mint + persist / 'file' / 'explicit').
 *
 * The token never reaches a log line (R7's banner is gone) — the logger
 * spy below pins that contract.
 *
 * Each test gets a fresh temp dir; the module takes the file path from
 * the env record, so there is no global state to reset.
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claimOwnerToken, resolveOwnerToken } from '../src/owner-token.js';
import { logger } from '../src/logger.js';

let dir: string;
let tokenFile: string;
let infoSpy: jest.SpyInstance;

function envRecord(overrides: Record<string, string> = {}): Record<string, string> {
  return { NEXTDO_OWNER_TOKEN_FILE: tokenFile, ...overrides };
}

/** All log lines emitted so far (joined for substring asserts). */
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
    expect(resolution).toEqual({ token: null, source: 'unclaimed' });
  });

  it('no env + no file → UNCLAIMED (token null, no file, no log output)', async () => {
    const resolution = await resolveOwnerToken(envRecord());
    expect(resolution).toEqual({ token: null, source: 'unclaimed' });
    await expect(stat(tokenFile)).rejects.toMatchObject({ code: 'ENOENT' });
    // The token is no longer printed at boot (R7 banner removed) — the
    // module must not emit a single log line.
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('an existing non-empty file is reused SILENTLY — no regeneration, no re-print', async () => {
    await mkdir(path.dirname(tokenFile), { recursive: true });
    await writeFile(tokenFile, 'stored-token-from-earlier-claim\n', 'utf8');

    const resolution = await resolveOwnerToken(envRecord());
    expect(resolution).toEqual({
      token: 'stored-token-from-earlier-claim',
      source: 'file',
    });
    expect(loggedText()).not.toContain('stored-token-from-earlier-claim');
  });

  it('a whitespace-only file is a failed claim → stays unclaimed (no rewrite at boot)', async () => {
    await mkdir(path.dirname(tokenFile), { recursive: true });
    await writeFile(tokenFile, '   \n', 'utf8');

    const resolution = await resolveOwnerToken(envRecord());
    expect(resolution).toEqual({ token: null, source: 'unclaimed' });
    expect((await readFile(tokenFile, 'utf8')).trim()).toBe('');
  });
});

describe('claimOwnerToken', () => {
  it('unclaimed (no env, no file) → mints a 64-hex token AND persists it', async () => {
    const result = await claimOwnerToken(envRecord());
    expect(result.claimed).toBe(true);
    if (!result.claimed) throw new Error('unreachable');
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect((await readFile(tokenFile, 'utf8')).trim()).toBe(result.token);
    // The mint is logged as an EVENT only — never the token value.
    expect(loggedText()).not.toContain(result.token);
  });

  it('a second claim (same boot) → { claimed: false, reason: "file" } (the persisted file closes it)', async () => {
    const first = await claimOwnerToken(envRecord());
    expect(first.claimed).toBe(true);
    const second = await claimOwnerToken(envRecord());
    expect(second).toEqual({ claimed: false, reason: 'file' });
  });

  it('an existing non-empty file → { claimed: false, reason: "file" } — the file is NOT rewritten', async () => {
    await mkdir(path.dirname(tokenFile), { recursive: true });
    await writeFile(tokenFile, 'pre-existing-token\n', 'utf8');

    const result = await claimOwnerToken(envRecord());

    expect(result).toEqual({ claimed: false, reason: 'file' });
    expect((await readFile(tokenFile, 'utf8')).trim()).toBe('pre-existing-token');
  });

  it('an explicit NEXTDO_OWNER_TOKEN → { claimed: false, reason: "explicit" } — the env token is never served and no file is written', async () => {
    const result = await claimOwnerToken(
      envRecord({ NEXTDO_OWNER_TOKEN: 'env-secret-token' }),
    );
    expect(result).toEqual({ claimed: false, reason: 'explicit' });
    await expect(stat(tokenFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('an empty NEXTDO_OWNER_TOKEN ("") is treated as unset → claimable', async () => {
    const result = await claimOwnerToken(
      envRecord({ NEXTDO_OWNER_TOKEN: '' }),
    );
    expect(result.claimed).toBe(true);
  });

  it('a whitespace-only file is a failed claim → claimable', async () => {
    await mkdir(path.dirname(tokenFile), { recursive: true });
    await writeFile(tokenFile, '   \n', 'utf8');

    const result = await claimOwnerToken(envRecord());

    expect(result.claimed).toBe(true);
    if (!result.claimed) throw new Error('unreachable');
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect((await readFile(tokenFile, 'utf8')).trim()).toBe(result.token);
  });

  it('a claim is durable across a restart: re-resolving reads the SAME token from the file', async () => {
    const claimed = await claimOwnerToken(envRecord());
    expect(claimed.claimed).toBe(true);
    if (!claimed.claimed) throw new Error('unreachable');

    // "Restart" = a fresh resolveOwnerToken against the same env/file:
    // silent file reuse (no second claim, no rotation).
    const restarted = await resolveOwnerToken(envRecord());
    expect(restarted).toEqual({ token: claimed.token, source: 'file' });
  });
});
