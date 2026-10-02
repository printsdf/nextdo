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
 * Parse a pasted connection string, or return null when the input is not
 * one (a bare owner token, an empty field, or garbage).
 *
 * Both shapes must carry BOTH parts: a half-filled string is not a
 * connection string, and silently treating the address part as a token
 * would produce a confusing "token 不正确" instead of a clear parse
 * failure.
 */
export function parseConnectionString(input: string): ParsedConnection | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  if (trimmed.startsWith(DEEP_LINK_SCHEME)) {
    return parseDeepLink(trimmed);
  }

  // Plaintext `<base>|<token>`: exactly one pipe. A token is hex/base64
  // and never contains `|`, so the FIRST pipe splits; a second one means
  // the input is malformed rather than something to silently repair.
  const pipes = trimmed.split('|');
  if (pipes.length !== 2) return null;
  const [address = '', token = ''] = pipes;
  if (address.trim() === '' || token.trim() === '') return null;
  return { serverAddress: address.trim(), token: token.trim() };
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
  const serverAddress = (params.get('s') ?? '').trim();
  const token = (params.get('t') ?? '').trim();
  if (serverAddress === '' || token === '') return null;
  return { serverAddress, token };
}