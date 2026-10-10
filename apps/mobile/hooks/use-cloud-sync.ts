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
 * - `connect(input)` — accepts EITHER `{ serverAddress, token }` (the
 *   normal path: one base address, `deriveSyncConfig` appends `/api` +
 *   `/sync`) OR `{ backendUrl, endpoint, token }` (the advanced path: the
 *   user typed both URLs, nothing is derived). Three client-side checks
 *   (empty address / not an absolute http(s) URL / empty token) run BEFORE
 *   any network, in the same order for both shapes. A non-empty token then
 *   goes to one `/credentials` round-trip (`fetchCredentialsOnce`); on 200
 *   the `endpoint` the server sent back overrides the derived/entered one
 *   (absent or malformed → the local value wins), then the config is stored
 *   FIRST and the owner token LAST (the token write is the single poke
 *   that drives the provider's connect — both must be stored by then).
 *   Never throws; each outcome maps to the user-facing copy (the R3
 *   three-state messages stay the single precedent: token 不正确 /
 *   连不上服务器，请稍后重试 / 保存失败).
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
  claimServer,
  clearOwnerToken,
  deriveSyncConfig,
  fetchClaimStatus,
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

function sanitizeInput(value: string): string {
  return value
    .replace(/^[\s\u200B-\u200D\uFEFF\u00A0\u3000]+|[\s\u200B-\u200D\uFEFF\u00A0\u3000]+$/g, '')
    .trim();
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

/**
 * Diagnostic error resolver for mobile connection failures.
 * Surfaces specific root causes (such as *.workers.dev blocked in mainland China,
 * localhost unreachable on mobile, or specific HTTP status codes) instead of
 * an opaque generic failure, while keeping default fallback for test compatibility.
 */
function resolveSyncErrorMessage(
  url: string,
  result: { kind: string; status?: number; detail?: string },
): string {
  if (result.kind === 'rejected') {
    if (result.status === 401) return 'token 不正确';
    if (result.status === 403) return '服务器拒绝访问 (403)，请检查防盗链或防火墙配置';
    if (result.status === 404) return '服务器路径不存在 (404)，请确认服务器已部署并启动 Nextdo 服务';
    if (result.status !== undefined && result.status >= 500) {
      return `服务器发生内部错误 (${result.status})，请检查服务器日志或稍后重试`;
    }
  }

  const lower = url.toLowerCase();
  if (lower.includes('workers.dev')) {
    return '连不上服务器：检测到使用了 workers.dev 域名，中国大陆网络无法直接访问，请在 Cloudflare 绑定自定义域名，或开启网络代理后重试';
  }
  if (lower.includes('localhost') || lower.includes('127.0.0.1')) {
    return '连不上服务器：移动端无法访问 localhost，请使用局域网 IP (如 192.168.x.x) 或公网域名';
  }

  if (result.detail && typeof result.detail === 'string') {
    if (result.detail.includes('Network request failed') && lower.startsWith('http://')) {
      return '连不上服务器：检测到使用了 http 明文连接，移动端可能限制了明文流量，请优先使用 https 域名或确认网络权限';
    }
    if (result.detail.includes('aborted') || result.detail.includes('timeout')) {
      return '连接超时：服务器未响应，请检查服务器是否正常运行或网络是否通畅';
    }
  }

  return '连不上服务器，请稍后重试';
}

export type CloudSyncState = 'connected' | 'disconnected' | 'loading';

/** The outcome of a connect attempt (never throws — mirrors the old
 *  ConnectGateResult contract, now owned by the Settings tab). */
export type ConnectOutcome = { ok: true } | { ok: false; message: string };

/**
 * The inputs to a connect (10-02-simplify-sync-setup). Two shapes, so the
 * caller states which kind of input it has rather than passing a
 * half-empty config:
 *
 *  - `{ serverAddress, token }` — the normal path. ONE base address; the
 *    two URLs come from `deriveSyncConfig` (and may then be overridden by
 *    whatever `endpoint` the server hands back with the credentials).
 *  - `{ backendUrl, endpoint, token }` — the advanced path: the user
 *    filled in both custom URLs in the collapsed 「高级设置」 section, so
 *    nothing is derived and the values are used verbatim.
 *
 * Either way the token is REQUIRED and the checks run BEFORE any network.
 */
export type ConnectInput =
  | { serverAddress: string; token: string }
  | { backendUrl: string; endpoint: string; token: string };

/** The three user-facing failure messages (single precedent — the copy
 *  never varies by which input shape was used, so the two entry points
 *  cannot drift). */
const ADDRESS_MISSING = '请先填写服务器地址';
const ADDRESS_INVALID = '地址无效，应以 http:// 或 https:// 开头';
const TOKEN_MISSING = '请先输入 owner token';

export function useCloudSync(): {
  state: CloudSyncState;
  storedConfig: StoredBackendConfig | null;
  ownerToken: string | null;
  connect: (input: ConnectInput) => Promise<ConnectOutcome>;
  disconnect: () => Promise<void>;
} {
  const [state, setState] = useState<CloudSyncState>('loading');
  const [storedConfig, setStoredConfig] = useState<StoredBackendConfig | null>(null);
  const [ownerToken, setOwnerTokenState] = useState<string | null>(null);

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
        setOwnerTokenState(token);
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

  // Client-side checks with ZERO network (empty address, address validity,
  // empty token), then ONE /credentials round-trip, then store the config
  // FIRST and the owner token LAST — the token write is the single poke
  // that drives the provider's connect() (by the time it fires, both are
  // stored). The change notification flips this hook too.
  const connect = useCallback(
    async (input: ConnectInput): Promise<ConnectOutcome> => {
      const trimmedToken = input.token.trim();

      // Resolve the two input shapes into one config BEFORE any validation
      // so the checks below (and their ORDER) are identical for both.
      let config: StoredBackendConfig;
      if ('serverAddress' in input) {
        const trimmedServer = sanitizeInput(input.serverAddress);
        if (trimmedServer === '') {
          return { ok: false, message: ADDRESS_MISSING };
        }
        try {
          // The one-address rule: /api + /sync follow from the deployment's
          // path layout. Lives in packages/db so the derivation and the
          // storage-time validation can never disagree.
          config = deriveSyncConfig(trimmedServer);
        } catch {
          return { ok: false, message: ADDRESS_INVALID };
        }
      } else {
        const trimmedBackend = sanitizeInput(input.backendUrl);
        const trimmedEndpoint = sanitizeInput(input.endpoint);
        if (trimmedBackend === '' || trimmedEndpoint === '') {
          return { ok: false, message: ADDRESS_MISSING };
        }
        if (!isHttpUrl(trimmedBackend) || !isHttpUrl(trimmedEndpoint)) {
          return { ok: false, message: ADDRESS_INVALID };
        }
        config = { backendUrl: trimmedBackend, endpoint: trimmedEndpoint };
      }

      let effectiveToken = trimmedToken;
      if (effectiveToken === '') {
        // Token is empty: check if the server is unclaimed and can be auto-claimed.
        let claimStatus = await fetchClaimStatus(config.backendUrl);
        // Fallback: If 404 and backendUrl ends with /api, try the bare base path without /api
        if (
          !claimStatus.ok &&
          claimStatus.kind === 'rejected' &&
          claimStatus.status === 404 &&
          config.backendUrl.endsWith('/api')
        ) {
          const fallbackBackendUrl = config.backendUrl.slice(0, -4);
          const fallbackClaim = await fetchClaimStatus(fallbackBackendUrl);
          if (fallbackClaim.ok || fallbackClaim.kind === 'rejected') {
            claimStatus = fallbackClaim;
            if (fallbackClaim.ok) {
              config = { ...config, backendUrl: fallbackBackendUrl };
            }
          }
        }

        if (!claimStatus.ok) {
          if (claimStatus.kind === 'network') {
            return { ok: false, message: resolveSyncErrorMessage(config.backendUrl, claimStatus) };
          }
          return { ok: false, message: TOKEN_MISSING };
        }

        if (claimStatus.claimed) {
          return {
            ok: false,
            message: '该服务器已绑定主人设备，请输入 owner token 或使用已配对设备扫码',
          };
        }

        // Server is unclaimed: auto-claim and establish initial token
        const claimResult = await claimServer(config.backendUrl);
        if (!claimResult.ok) {
          if (claimResult.kind === 'already_claimed') {
            return {
              ok: false,
              message: '该服务器已绑定主人设备，请输入 owner token 或使用已配对设备扫码',
            };
          }
          return { ok: false, message: resolveSyncErrorMessage(config.backendUrl, claimResult) };
        }
        effectiveToken = claimResult.ownerToken;
      }

      let result = await fetchCredentialsOnce(config, effectiveToken);
      // Fallback: If 404 and backendUrl ends with /api, try the bare base path without /api
      if (
        !result.ok &&
        result.kind === 'rejected' &&
        result.status === 404 &&
        config.backendUrl.endsWith('/api')
      ) {
        const fallbackConfig: StoredBackendConfig = {
          backendUrl: config.backendUrl.slice(0, -4),
          endpoint: config.endpoint,
        };
        const fallbackResult = await fetchCredentialsOnce(fallbackConfig, effectiveToken);
        if (fallbackResult.ok || fallbackResult.kind === 'rejected') {
          result = fallbackResult;
          if (fallbackResult.ok) {
            config = fallbackConfig;
          }
        }
      }

      if (result.ok) {
        // The deployment's own stream URL (NEXTDO_SYNC_ENDPOINT, handed
        // back with the credentials) WINS over the derived one — that is
        // the whole point of the server telling the client. Absent or
        // malformed → keep the derived/entered value, which is what keeps
        // old servers working. Never an error: a bad endpoint is ignored,
        // not surfaced (design D3).
        const finalConfig: StoredBackendConfig = {
          backendUrl: config.backendUrl,
          endpoint: result.endpoint ?? config.endpoint,
        };
        try {
          await setStoredBackendConfig(finalConfig); // config first…
          await setOwnerToken(effectiveToken); // …then the token (the poke)
          return { ok: true };
        } catch (error) {
          logger.error('sync config save failed', toError(error));
          return { ok: false, message: 'token 验证通过，但保存失败，请重试' };
        }
      }
      if (result.ok === false && result.kind === 'rejected' && result.status === 401) {
        return { ok: false, message: 'token 不正确' };
      }
      logger.warn('connect attempt failed', result);
      // Network failure / 5xx / malformed 200 body: the token is NOT
      // invalidated — the server is unreachable or unhealthy, retry later.
      return { ok: false, message: resolveSyncErrorMessage(config.backendUrl, result) };
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

  return { state, storedConfig, ownerToken, connect, disconnect };
}
