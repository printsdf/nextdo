/**
 * Cloud-sync connection state (prod-deploy R6 — sync is OPTIONAL; OSS
 * task 09-28 — the server addresses are USER-CONFIGURED).
 *
 * The app is local-first: no stored owner token → PowerSync stays
 * disconnected, the local DB is still the source of truth. This hook is the
 * single reader/writer of the connection state for the Settings tab:
 *
 * - `state` — 'connected' (a token is stored) / 'disconnected' / 'loading'
 *   (the first read from storage is in flight). It follows the SAME
 *   `subscribeToOwnerTokenChange` notification the root layout's provider
 *   uses to drive `connect()`/`disconnect()`, so the UI can never diverge
 *   from the actual sync lifecycle.
 * - `storedConfig` — the stored sync-server URLs (`{ backendUrl, endpoint }`
 *   | null), read on mount and re-read on every poke. Prefills the address
 *   inputs and backs the connected view's read-only address display.
 * - `connect({ backendUrl, endpoint, token })` — two client-side address
 *   checks (empty / not an absolute http(s) URL) run BEFORE any network.
 *   Then it branches on the token:
 *     * token NON-EMPTY → one `/credentials` round-trip
 *       (`fetchCredentialsOnce`); on 200 it stores the config FIRST and
 *       the owner token LAST (the token write is the single poke that
 *       drives the provider's connect — both must be stored by then).
 *     * token EMPTY → the one-time claim (`claimOwnerTokenOnce`,
 *       `POST /claim`): the server mints the owner token ONCE and returns
 *       it; on 200 the SAME config-then-token storage order applies.
 *   Never throws; each outcome maps to the user-facing copy (the R3
 *   three-state messages stay the single precedent; the claim adds
 *   「服务器已有 token，请手动输入」for a 409).
 * - `disconnect()` — `clearOwnerToken` (the stored addresses are KEPT, so a
 *   reconnect only needs a new token); the notification drives the
 *   provider's disconnect. Local data is untouched (nothing destructive, so
 *   v1 confirms nothing).
 *
 * Hook-guidelines: this is a UI hook (transient per-screen state over the
 * auth boundary); all network work goes through `packages/db`'s sync layer
 * — never a raw fetch here.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  claimOwnerTokenOnce,
  clearOwnerToken,
  fetchCredentialsOnce,
  getOwnerToken,
  getStoredBackendConfig,
  setOwnerToken,
  setStoredBackendConfig,
  subscribeToOwnerTokenChange,
  type StoredBackendConfig,
} from '@nextdo/db';
import { logger } from '@nextdo/core';

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** The client-side address check — the same rule the storage layer enforces
 *  (`new URL` + protocol ∈ {http:, https:}); the UI only needs the boolean,
 *  not the typed error. */
function isHttpUrl(value: string): boolean {
  if (value === '') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export type CloudSyncState = 'connected' | 'disconnected' | 'loading';

/** The outcome of a connect attempt (never throws — mirrors the old
 *  ConnectGateResult contract, now owned by the Settings tab). */
export type ConnectOutcome = { ok: true } | { ok: false; message: string };

/** The inputs to a connect: the two sync-server addresses + the owner token. */
export type ConnectInput = {
  backendUrl: string;
  endpoint: string;
  token: string;
};

export function useCloudSync(): {
  state: CloudSyncState;
  storedConfig: StoredBackendConfig | null;
  connect: (input: ConnectInput) => Promise<ConnectOutcome>;
  disconnect: () => Promise<void>;
} {
  const [state, setState] = useState<CloudSyncState>('loading');
  const [storedConfig, setStoredConfig] = useState<StoredBackendConfig | null>(null);

  // Read once on mount, then follow sign-in / sign-out for the screen's
  // life (the same poke-and-reread contract as the provider). The token AND
  // the stored addresses are re-read on every poke; a failed read is treated
  // as null (re-entering is the recovery path) rather than a wedge.
  useEffect(() => {
    let disposed = false;
    const refresh = async (): Promise<void> => {
      let token: string | null;
      try {
        token = await getOwnerToken();
      } catch (error) {
        logger.error('owner token read failed', toError(error));
        token = null;
      }
      let config: StoredBackendConfig | null;
      try {
        config = await getStoredBackendConfig();
      } catch (error) {
        logger.error('stored backend config read failed', toError(error));
        config = null;
      }
      if (!disposed) {
        setState(token === null ? 'disconnected' : 'connected');
        setStoredConfig(config);
      }
    };
    void refresh();
    const unsubscribe = subscribeToOwnerTokenChange(() => {
      void refresh();
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  // Two client-side address checks (no network), then EITHER the claim
  // (empty token) OR ONE /credentials round-trip (non-empty token), then
  // store the config FIRST and the owner token LAST in both branches —
  // the token write is the single poke that drives the provider's
  // connect() (by the time it fires, both are stored). The change
  // notification flips this hook too.
  const connect = useCallback(
    async ({ backendUrl, endpoint, token }: ConnectInput): Promise<ConnectOutcome> => {
      const trimmedBackend = backendUrl.trim();
      const trimmedEndpoint = endpoint.trim();
      const trimmedToken = token.trim();
      if (trimmedBackend === '' || trimmedEndpoint === '') {
        return { ok: false, message: '请先填写服务器地址' };
      }
      if (!isHttpUrl(trimmedBackend) || !isHttpUrl(trimmedEndpoint)) {
        return { ok: false, message: '地址无效，应以 http:// 或 https:// 开头' };
      }
      const config: StoredBackendConfig = { backendUrl: trimmedBackend, endpoint: trimmedEndpoint };
      if (trimmedToken === '') {
        // Empty token = first-connect bootstrap (claim task 09-28): the
        // server mints the owner token ONCE and returns it in the 200.
        const claimed = await claimOwnerTokenOnce(config);
        if (claimed.ok) {
          try {
            await setStoredBackendConfig(config); // config first…
            await setOwnerToken(claimed.token); // …then the token (the poke)
            return { ok: true };
          } catch (error) {
            logger.error('sync config save failed', toError(error));
            return { ok: false, message: 'token 验证通过，但保存失败，请重试' };
          }
        }
        if (claimed.kind === 'claimed') {
          // The server already has a token (already claimed, or an
          // explicit env token it never serves) — the user enters it.
          return { ok: false, message: '服务器已有 token，请手动输入' };
        }
        // Network failure / 5xx / malformed 200: retry later (same copy
        // as the credentials path — the server is unreachable or
        // unhealthy, nothing is invalidated).
        return { ok: false, message: '连不上服务器，请稍后重试' };
      }
      const result = await fetchCredentialsOnce(config, trimmedToken);
      if (result.ok) {
        try {
          await setStoredBackendConfig(config); // config first…
          await setOwnerToken(trimmedToken); // …then the token (the poke)
          return { ok: true };
        } catch (error) {
          logger.error('sync config save failed', toError(error));
          return { ok: false, message: 'token 验证通过，但保存失败，请重试' };
        }
      }
      if (result.ok === false && result.kind === 'rejected' && result.status === 401) {
        return { ok: false, message: 'token 不正确' };
      }
      // Network failure / 5xx / malformed 200 body: the token is NOT
      // invalidated — the server is unreachable or unhealthy, retry later.
      return { ok: false, message: '连不上服务器，请稍后重试' };
    },
    [],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    try {
      await clearOwnerToken();
    } catch (error) {
      logger.error('owner token clear failed', toError(error));
    }
  }, []);

  return { state, storedConfig, connect, disconnect };
}
