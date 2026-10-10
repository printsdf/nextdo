/**
 * Connection-string parsing (10-02-simplify-sync-setup) — one paste instead
 * of hand-typing a 64-hex owner token plus guessing a path layout.
 *
 * Two shapes, ONE parser (design D5):
 *
 *   deep link : nextdo://sync?s=<encoded base address>&t=<encoded token>
 *   plaintext : <base address>|<token>
 *
 * The deep link is what a QR code / `nextdo://` tap delivers on a phone;
 * the pipe form is what a terminal copy-paste produces on desktop (a
 * `|` is unambiguous, unlike base64's `+/=`). Tauri desktop registers no
 * system protocol, so desktop always uses the plaintext form.
 *
 * A BARE token (no address, no pipe, no `nextdo://`) returns null — the
 * caller then falls back to the pre-existing behavior of "this field is
 * just the token", so a user who only has the token can still paste it.
 *
 * Pure and platform-free (no React, no expo modules) — same tier as
 * `snooze-options.ts`, directly unit-testable.
 */

/** The parsed pieces the Settings tab / deep-link route hand to connect(). */
export interface ParsedConnection {
  /** The BASE server address (no `/api`, no `/sync`) — `deriveSyncConfig`
   *  completes it. */
  serverAddress: string;
  token: string;
}

/** The custom scheme registered in app.json (`"scheme": "nextdo"`). */
const DEEP_LINK_SCHEME = 'nextdo://';

/**
 * Strip invisible Unicode characters (zero-width spaces, BOM, control whitespace, ideographic space)
 * and trim. Common when pasting URLs from mobile chat apps (WeChat, Feishu, etc.).
 */
export function sanitizeConnectionText(str: string): string {
  return str
    .replace(/^[\s\u200B-\u200D\uFEFF\u00A0\u3000]+|[\s\u200B-\u200D\uFEFF\u00A0\u3000]+$/g, '')
    .trim();
}

/**
 * Format a plaintext connection string `<base address>|<token>`.
 * Returns empty string if either piece is empty or blank.
 */
export function formatConnectionString(serverAddress: string, token: string): string {
  const trimmedAddress = sanitizeConnectionText(serverAddress);
  const trimmedToken = sanitizeConnectionText(token);
  if (trimmedAddress === '' || trimmedToken === '') return '';
  return `${trimmedAddress}|${trimmedToken}`;
}

/**
 * Format a mobile deep link `nextdo://sync?s=<encoded base>&t=<encoded token>`.
 * Returns empty string if either piece is empty or blank.
 */
export function formatDeepLink(serverAddress: string, token: string): string {
  const trimmedAddress = sanitizeConnectionText(serverAddress);
  const trimmedToken = sanitizeConnectionText(token);
  if (trimmedAddress === '' || trimmedToken === '') return '';
  return `${DEEP_LINK_SCHEME}sync?s=${encodeURIComponent(trimmedAddress)}&t=${encodeURIComponent(trimmedToken)}`;
}

/**
 * Parse a pasted connection string, or return null when the input is not
 * one (a bare owner token, an empty field, or garbage).
 *
 * Both shapes must carry BOTH parts: a half-filled string is not a
 * connection string, and silently treating the address part as a token
 * would produce a confusing "token 不正确" instead of a clear parse
 * failure.
 */
export function parseConnectionString(input: string): ParsedConnection | null {
  const trimmed = sanitizeConnectionText(input);
  if (trimmed === '') return null;

  // Deep link (supports bare deep link or with prefix)
  const schemeIndex = trimmed.indexOf(DEEP_LINK_SCHEME);
  if (schemeIndex !== -1) {
    const candidate = trimmed.slice(schemeIndex).split(/\s+/)[0] || '';
    const parsed = parseDeepLink(candidate);
    if (parsed) return parsed;
  }

  // Plaintext `<base>|<token>`: exactly one pipe (supports standard '|' and full-width '｜').
  // A token is hex/base64 and never contains `|`, so the FIRST pipe splits;
  // a second one means the input is malformed rather than something to silently repair.
  const normalizedPipes = trimmed.replace(/｜/g, '|');
  const pipes = normalizedPipes.split('|');
  if (pipes.length !== 2) return null;
  const [rawAddress = '', rawToken = ''] = pipes;

  // Strip potential prefixes like "连接串：" or "自建地址+连接串：" or "云同步连接串："
  const httpIndex = rawAddress.search(/https?:\/\//i);
  let address = httpIndex !== -1 ? rawAddress.slice(httpIndex) : rawAddress;
  if (httpIndex === -1) {
    const colonIndex = address.search(/[:：]/);
    if (colonIndex !== -1) {
      address = address.slice(colonIndex + 1);
    }
  }
  address = sanitizeConnectionText(address);
  const token = sanitizeConnectionText(rawToken).replace(/\s+/g, '');

  if (address === '' || token === '') return null;

  if (!address.startsWith('http://') && !address.startsWith('https://') && address.includes('.')) {
    address = `https://${address}`;
  }

  return { serverAddress: address, token };
}

/** `nextdo://sync?s=<encoded base>&t=<encoded token>` — the query string
 *  carries both parts URL-encoded (a server address is full of `:` and
 *  `/`, which must not terminate the parameter). */
function parseDeepLink(trimmed: string): ParsedConnection | null {
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  // `nextdo://sync?s=…` parses with host = 'sync'; also accept the
  // `nextdo:/sync?s=…` / `nextdo:///sync?s=…` spellings an OS may hand over.
  const params = url.searchParams;
  let serverAddress = sanitizeConnectionText(params.get('s') ?? '');
  let token = sanitizeConnectionText(params.get('t') ?? '');

  try {
    if (serverAddress.includes('%')) {
      serverAddress = sanitizeConnectionText(decodeURIComponent(serverAddress));
    }
  } catch {
    // Ignore decode errors
  }
  try {
    if (token.includes('%')) {
      token = sanitizeConnectionText(decodeURIComponent(token));
    }
  } catch {
    // Ignore decode errors
  }

  if (serverAddress === '' || token === '') return null;

  if (
    !serverAddress.startsWith('http://') &&
    !serverAddress.startsWith('https://') &&
    serverAddress.includes('.')
  ) {
    serverAddress = `https://${serverAddress}`;
  }

  return { serverAddress, token };
}