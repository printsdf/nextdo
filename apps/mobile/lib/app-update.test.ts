/**
 * Unit tests — the update check's pure layer (lib/app-update).
 *
 * The contract these pin: **no GitHub URL ever leaves the app un-proxied**.
 * `viaProxy` / `latestReleaseUrl` / `releasePageUrl` / `pickDownloads` are
 * the only ways a URL reaches the user or the network, so every assertion
 * below is on the prefixed form. `fetchLatestRelease` and the runtime probes
 * (`detectUpdatePlatform` / `currentAppVersion`) are exercised end-to-end in
 * `__tests__/settings-screen.test.tsx`.
 */
import {
  UPDATE_PROXY_PREFIX,
  compareVersions,
  detectMacArch,
  latestReleaseUrl,
  parseLatestTag,
  pickDownloads,
  releasePageUrl,
  viaProxy,
  type LatestRelease,
} from './app-update';

const PREFIX = UPDATE_PROXY_PREFIX;
const DOWNLOAD = 'https://github.com/printsdf/nextdo/releases/download';
const TAG = 'v0.1.4';

function release(tag = TAG): LatestRelease {
  return { tag, version: tag.replace(/^v/i, '') };
}

describe('proxy prefixing', () => {
  it('every URL is served through the accelerator, never straight from GitHub', () => {
    expect(PREFIX).toBe('https://proxyd.picpi.top/');
    expect(viaProxy('https://github.com/a/b')).toBe(`${PREFIX}https://github.com/a/b`);
    expect(latestReleaseUrl()).toBe(`${PREFIX}https://github.com/printsdf/nextdo/releases/latest`);
    expect(releasePageUrl()).toBe(`${PREFIX}https://github.com/printsdf/nextdo/releases/latest`);
  });

  it('the version query does NOT use the GitHub API (a shared proxy IP gets rate-limited)', () => {
    expect(latestReleaseUrl()).not.toContain('api.github.com');
  });
});

describe('compareVersions', () => {
  it.each([
    ['0.1.4', '0.1.3', 1],
    ['0.1.3', '0.1.4', -1],
    ['0.1.3', '0.1.3', 0],
    // The `v` tag prefix is irrelevant.
    ['v0.2.0', '0.1.9', 1],
    // Missing segments read as zeros, so short and long forms tie.
    ['0.2', '0.2.0', 0],
    ['0.2.1', '0.2', 1],
    // Ten beats nine — a plain string compare would get this wrong.
    ['0.1.10', '0.1.9', 1],
    ['0.10.0', '0.9.9', 1],
    // A release outranks its own prereleases — this app's daily case
    // (local build 0.1.3-beta.1 vs published v0.1.3).
    ['0.1.3', '0.1.3-beta.1', 1],
    ['0.1.3-beta.1', '0.1.3', -1],
    ['0.1.4-beta.2', '0.1.4-beta.1', 1],
    ['0.1.4-beta.1', '0.1.4-beta.1', 0],
  ])('compareVersions(%s, %s) = %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });
});

describe('parseLatestTag', () => {
  it('reads the tag out of the post-redirect URL, proxy prefix and all', () => {
    expect(parseLatestTag(`${PREFIX}https://github.com/printsdf/nextdo/releases/tag/v0.1.3`)).toBe(
      'v0.1.3',
    );
  });

  it('does not anchor on the host, so a different proxy domain still parses', () => {
    expect(parseLatestTag('https://another-proxy.example/https://github.com/a/b/releases/tag/v2.0.0')).toBe(
      'v2.0.0',
    );
  });

  it('keeps a prerelease tag intact', () => {
    expect(parseLatestTag(`${PREFIX}https://github.com/a/b/releases/tag/v1.2.3-beta.4`)).toBe(
      'v1.2.3-beta.4',
    );
  });

  it.each([
    ['the un-redirected URL', `${PREFIX}https://github.com/printsdf/nextdo/releases/latest`],
    ['an unrelated URL', 'https://example.com/'],
    ['a bare v tag', `${PREFIX}https://github.com/a/b/releases/tag/v`],
  ])('returns null for %s rather than throwing', (_label, url) => {
    expect(parseLatestTag(url)).toBeNull();
  });
});

describe('pickDownloads', () => {
  it('macOS gets EXACTLY ONE installer — the one matching the detected architecture', () => {
    expect(pickDownloads(release(), 'macos', 'aarch64')).toEqual([
      {
        label: 'macOS 安装包（Apple 芯片）',
        url: `${PREFIX}${DOWNLOAD}/v0.1.4/Nextdo_0.1.4_aarch64.dmg`,
      },
    ]);
    expect(pickDownloads(release(), 'macos', 'x86_64')).toEqual([
      {
        label: 'macOS 安装包（Intel）',
        url: `${PREFIX}${DOWNLOAD}/v0.1.4/Nextdo_0.1.4_x64.dmg`,
      },
    ]);
  });

  it('macOS with an UNKNOWN architecture gets NO installer — guessing wrong cannot install', () => {
    expect(pickDownloads(release(), 'macos', null)).toEqual([]);
    // 默认参数同样不能变成「给两个让用户选」。
    expect(pickDownloads(release(), 'macos')).toEqual([]);
  });

  it('Windows gets the NSIS installer, Linux gets deb + AppImage, Android the arm64 apk', () => {
    expect(pickDownloads(release(), 'windows')).toEqual([
      { label: 'Windows 安装程序', url: `${PREFIX}${DOWNLOAD}/v0.1.4/Nextdo_0.1.4_x64-setup.exe` },
    ]);
    expect(pickDownloads(release(), 'linux').map((d) => d.label)).toEqual([
      'Linux · deb',
      'Linux · AppImage',
    ]);
    expect(pickDownloads(release(), 'android')).toEqual([
      {
        label: 'Android 安装包',
        url: `${PREFIX}${DOWNLOAD}/v0.1.4/Nextdo_0.1.4_android_arm64-v8a.apk`,
      },
    ]);
  });

  it('a prerelease tag flows into the file name verbatim', () => {
    const downloads = pickDownloads(release('v0.2.0-beta.1'), 'windows');
    expect(downloads[0]!.url).toBe(
      `${PREFIX}${DOWNLOAD}/v0.2.0-beta.1/Nextdo_0.2.0-beta.1_x64-setup.exe`,
    );
  });

  it.each(['ios', 'web'] as const)('%s has no installer — the screen falls back to the release page', (platform) => {
    expect(pickDownloads(release(), platform)).toEqual([]);
  });

  it('never returns a URL without the proxy prefix', () => {
    for (const platform of ['macos', 'windows', 'linux', 'android'] as const) {
      const downloads =
        platform === 'macos'
          ? pickDownloads(release(), platform, 'aarch64')
          : pickDownloads(release(), platform);
      for (const download of downloads) {
        expect(download.url.startsWith(PREFIX)).toBe(true);
      }
    }
  });
});

describe('detectMacArch', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  function setWindow(value: unknown): void {
    (globalThis as { window?: unknown }).window = value;
  }

  it('asks the Tauri shell first — the only source that works inside WKWebView', async () => {
    const invoke = jest.fn().mockResolvedValue('aarch64');
    setWindow({ __TAURI_INTERNALS__: { invoke } });
    await expect(detectMacArch()).resolves.toBe('aarch64');
    expect(invoke).toHaveBeenCalledWith('current_arch');
  });

  it('normalizes the shapes both sources use (Rust ARCH / UA high-entropy)', async () => {
    setWindow({ __TAURI_INTERNALS__: { invoke: jest.fn().mockResolvedValue('x86_64') } });
    await expect(detectMacArch()).resolves.toBe('x86_64');

    setWindow({
      navigator: { userAgentData: { getHighEntropyValues: async () => ({ architecture: 'arm' }) } },
    });
    await expect(detectMacArch()).resolves.toBe('aarch64');

    setWindow({
      navigator: { userAgentData: { getHighEntropyValues: async () => ({ architecture: 'x86' }) } },
    });
    await expect(detectMacArch()).resolves.toBe('x86_64');
  });

  it('resolves null — never rejects — when the source is missing or fails', async () => {
    // Safari: no userAgentData at all.
    setWindow({ navigator: {} });
    await expect(detectMacArch()).resolves.toBeNull();

    // Nothing at all (SSR / bare test env).
    setWindow(undefined);
    await expect(detectMacArch()).resolves.toBeNull();

    // Desktop shell too old to expose the command → falls through, still null.
    setWindow({ __TAURI_INTERNALS__: { invoke: jest.fn().mockRejectedValue(new Error('not found')) } });
    await expect(detectMacArch()).resolves.toBeNull();

    // API present but throws (some Chromium builds gate the high-entropy API).
    setWindow({
      navigator: { userAgentData: { getHighEntropyValues: async () => { throw new Error('denied'); } } },
    });
    await expect(detectMacArch()).resolves.toBeNull();
  });

  it('an unrecognized architecture string is null, not a coin flip', async () => {
    setWindow({ __TAURI_INTERNALS__: { invoke: jest.fn().mockResolvedValue('riscv64') } });
    await expect(detectMacArch()).resolves.toBeNull();
  });
});