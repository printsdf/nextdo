/**
 * Cloud-sync connection state (prod-deploy R6 — sync is OPTIONAL).
 *
 * The app is local-first: no owner token → PowerSync stays disconnected,
 * the local DB is still the source of truth. This hook is the single
 * reader/writer of the connection state for the Settings tab:
 *
 * - `state` — 'connected' (a token is stored) / 'disconnected' / 'loading'
 *   (the first read from storage is in flight). It follows the SAME
 *   `subscribeToOwnerTokenChange` notification the root layout's provider
 *   uses to drive `connect()`/`disconnect()`, so the UI can never diverge
 *   from the actual sync lifecycle.
 * - `connect(token)` — one `/credentials` round-trip (`fetchCredentialsOnce`),
 *   then `setOwnerToken` on success. Never throws; maps each outcome to the
 *   user-facing copy (the three R3 messages stay the single precedent).
 * - `disconnect()` — `clearOwnerToken`; the notification drives the
 *   provider's disconnect. Local data is untouched (there is no destructive
 *   path, so v1 confirms nothing).
 *
 * Hook-guidelines: this is a UI hook (transient per-screen state over the
 * auth boundary); all network work goes through `packages/db`'s sync layer
 * — never a raw fetch here.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  clearOwnerToken,
  fetchCredentialsOnce,
  getOwnerToken,
  setOwnerToken,
  subscribeToOwnerTokenChange,
} from '@nextdo/db';
import { logger } from '@nextdo/core';
import { getBackendConfig } from '@/lib/env';

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export type CloudSyncState = 'connected' | 'disconnected' | 'loading';

/** The outcome of a connect attempt (never throws — mirrors the old
 *  ConnectGateResult contract, now owned by the Settings tab). */
export type ConnectOutcome = { ok: true } | { ok: false; message: string };

export function useCloudSync(): {
  state: CloudSyncState;
  connect: (token: string) => Promise<ConnectOutcome>;
  disconnect: () => Promise<void>;
} {
  const [state, setState] = useState<CloudSyncState>('loading');

  // Read once on mount, then follow sign-in / sign-out for the screen's
  // life (the same poke-and-reread contract as the provider).
  useEffect(() => {
    let disposed = false;
    const refresh = async (): Promise<void> => {
      let token: string | null;
      try {
        token = await getOwnerToken();
      } catch (error) {
        // A storage failure must not wedge the screen on 'loading' —
        // the disconnected view (re-entering a token) is the recovery path.
        logger.error('owner token read failed', toError(error));
        token = null;
      }
      if (!disposed) setState(token === null ? 'disconnected' : 'connected');
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

  // One /credentials round-trip, then store the OWNER token (NOT the
  // minted service JWT). The change notification flips this hook AND
  // drives the provider's connect() — one mechanism.
  const connect = useCallback(async (rawToken: string): Promise<ConnectOutcome> => {
    const token = rawToken.trim();
    if (token === '') {
      return { ok: false, message: 'token 不能为空' };
    }
    const result = await fetchCredentialsOnce(getBackendConfig(), token);
    if (result.ok) {
      try {
        await setOwnerToken(token);
        return { ok: true };
      } catch (error) {
        logger.error('owner token save failed', toError(error));
        return { ok: false, message: 'token 验证通过，但保存失败，请重试' };
      }
    }
    if (result.ok === false && result.kind === 'rejected' && result.status === 401) {
      return { ok: false, message: 'token 不正确' };
    }
    // Network failure / 5xx / malformed 200 body: the token is NOT
    // invalidated — the server is unreachable or unhealthy, retry later.
    return { ok: false, message: '连不上服务器，请稍后重试' };
  }, []);

  const disconnect = useCallback(async (): Promise<void> => {
    try {
      await clearOwnerToken();
    } catch (error) {
      logger.error('owner token clear failed', toError(error));
    }
  }, []);

  return { state, connect, disconnect };
}
