/**
 * PowerSync server claim protocol — supports one-time setup and pairing.
 *
 * Checks whether a server is already claimed (`/claim/status`) and claims it
 * (`POST /claim`) to establish the initial owner token.
 */

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeBaseUrl(backendUrl: string): string {
  return backendUrl.replace(/\/+$/, '');
}

export type FetchClaimStatusResult =
  | { ok: true; claimed: boolean }
  | { ok: false; kind: 'network' | 'invalid' | 'rejected'; detail?: string; status?: number };

export type ClaimServerResult =
  | { ok: true; ownerToken: string }
  | { ok: false; kind: 'already_claimed' | 'network' | 'rejected'; detail?: string; status?: number };

/**
 * Check whether the server at `backendUrl` has already been claimed by an owner.
 * Never throws — network errors return `{ ok: false, kind: 'network' }`.
 */
export async function fetchClaimStatus(backendUrl: string): Promise<FetchClaimStatusResult> {
  const url = `${sanitizeBaseUrl(backendUrl)}/claim/status`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    return { ok: false, kind: 'network', detail: errorMessage(err) };
  }

  if (!res.ok) {
    return { ok: false, kind: 'rejected', status: res.status };
  }

  const data = (await res.json().catch(() => null)) as { claimed?: unknown } | null;
  if (data === null || typeof data.claimed !== 'boolean') {
    return { ok: false, kind: 'invalid' };
  }

  return { ok: true, claimed: data.claimed };
}

/**
 * Claim an unclaimed server at `backendUrl`.
 * If `ownerToken` is omitted, the server generates a cryptographically secure 64-hex token.
 * Returns the established `ownerToken`.
 *
 * If the server is already claimed, returns `{ ok: false, kind: 'already_claimed' }`.
 */
export async function claimServer(backendUrl: string, ownerToken?: string): Promise<ClaimServerResult> {
  const url = `${sanitizeBaseUrl(backendUrl)}/claim`;
  let res: Response;
  const body = ownerToken?.trim() ? JSON.stringify({ ownerToken: ownerToken.trim() }) : undefined;

  try {
    res = await fetch(url, {
      method: 'POST',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body,
    });
  } catch (err) {
    return { ok: false, kind: 'network', detail: errorMessage(err) };
  }

  if (res.status === 409) {
    return { ok: false, kind: 'already_claimed', status: 409 };
  }

  if (!res.ok) {
    return { ok: false, kind: 'rejected', status: res.status };
  }

  const data = (await res.json().catch(() => null)) as { ok?: unknown; ownerToken?: unknown } | null;
  if (data === null || data.ok !== true || typeof data.ownerToken !== 'string' || data.ownerToken === '') {
    return { ok: false, kind: 'rejected', status: res.status, detail: 'malformed claim response' };
  }

  return { ok: true, ownerToken: data.ownerToken };
}
