/**
 * Root layout (design.md §4): the PowerSync provider (the `packages/db`
 * platform client instance, connected once) + the navigation stack.
 *
 * - The instance is created once per app launch — it owns the local SQLite
 *   and the sync/upload loops.
 * - The connect/disconnect lifecycle is owned by the app, driven by the
 *   owner-token state (via `subscribeToOwnerTokenChange`): `connect()` is
 *   called only while an owner token is stored, and `disconnect()` when it
 *   is not. The PowerSync v2 SDK does NOT idle on null credentials — calling
 *   `connect()` while signed out makes its sync loop retry `buildRequest()`
 *   forever and log "Not signed in" every cycle. Offline (no token) the app
 *   still works against the local DB; it simply does not sync.
 * - The single v1 stream is subscribed explicitly once after init (the
 *   service declares it `auto_subscribe: true`; the stream name stays in
 *   `packages/db`).
 * - Auth gate (prod-deploy R3): at startup the stored owner token is
 *   validated with `fetchCredentialsOnce` BEFORE the app renders — the
 *   PowerSync v2 SDK swallows 401s in its retry loop, so the app can only
 *   know "wrong token" from an explicit round-trip. No token (or a 401)
 *   shows the full-screen ConnectGate INSTEAD of the app; network errors
 *   let the app run offline-first (the SDK retries in the background).
 * - Font gate (design §1.3): Epilogue + Plus Jakarta Sans load before the
 *   stack renders; until then a canvas placeholder stands in (no white
 *   flash, no `expo-splash-screen` dependency).
 */
import '../global.css';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import {
  Epilogue_500Medium,
  Epilogue_600SemiBold,
  Epilogue_700Bold,
} from '@expo-google-fonts/epilogue';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { PowerSyncContext } from '@powersync/react';
import {
  clearOwnerToken,
  createPowerSyncConnector,
  createPowerSyncDatabase,
  fetchCredentialsOnce,
  getOwnerToken,
  isReactNativeRuntime,
  setOwnerToken,
  subscribeAppStream,
  subscribeToOwnerTokenChange,
} from '@nextdo/db';
import { logger } from '@nextdo/core';
import { ConnectGate, type ConnectGateResult } from '@/components/connect-gate';
import { POWERSYNC_WEB_WORKER_PATH, getBackendConfig } from '@/lib/env';

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/* ---------------- Web font gate ----------------
 *
 * expo-font's web path verifies a font load with `fontfaceobserver`,
 * which polls `document.fonts.load()` and is unreliable in WebKit (the
 * Tauri macOS webview): it rejects with a 12000ms timeout even though
 * the font is applied. On web we therefore load each face with the
 * standard FontFace API instead — one explicit success/failure per
 * face, no polling. `useFonts` still owns native (see RootLayout).
 *
 * The app tsconfig lib is ES2022 without DOM (packages/db follows the
 * same pattern), so the web globals are reached through typed views.
 */
const WEB_FONT_TIMEOUT_MS = 12000;

/** Same faces the native `useFonts` maps in RootLayout (display:
 *  Epilogue, body: Plus Jakarta Sans — design §1.3). At runtime the
 *  constants are asset URI strings on web (typed `number` for native). */
const WEB_FONT_FACES: ReadonlyArray<readonly [family: string, source: number | string]> = [
  ['Epilogue', Epilogue_600SemiBold],
  ['Epilogue_500Medium', Epilogue_500Medium],
  ['Epilogue_600SemiBold', Epilogue_600SemiBold],
  ['Epilogue_700Bold', Epilogue_700Bold],
  ['Plus Jakarta Sans', PlusJakartaSans_400Regular],
  ['PlusJakartaSans_400Regular', PlusJakartaSans_400Regular],
  ['PlusJakartaSans_500Medium', PlusJakartaSans_500Medium],
  ['PlusJakartaSans_600SemiBold', PlusJakartaSans_600SemiBold],
  ['PlusJakartaSans_700Bold', PlusJakartaSans_700Bold],
];

type WebFontCtor = new (family: string, source: string) => { load(): Promise<unknown> };

/** Load ONE face with the FontFace API and register it in
 *  document.fonts so `fontFamily: 'Epilogue'` & co. resolve. Rejects on
 *  network/decode failure (a hung fetch is bounded by the caller's
 *  timeout, not by this promise). */
function loadWebFontFace(family: string, uri: string): Promise<void> {
  const g = globalThis as unknown as {
    FontFace?: WebFontCtor;
    document: { fonts: { add(face: unknown): void } };
  };
  const FontFaceCtor = g.FontFace;
  if (typeof FontFaceCtor === 'undefined') {
    return Promise.reject(new Error('FontFace API unavailable'));
  }
  const face = new FontFaceCtor(family, `url("${uri}")`);
  return face.load().then((loaded) => {
    g.document.fonts.add(loaded);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: ${ms}ms timeout exceeded`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** PowerSyncContext.Provider wrapper — the ONLY `@powersync/react` usage
 *  outside the data hooks (database-guidelines boundary). */
function PowerSyncProvider({ children }: { children: ReactNode }) {
  const powersync = useMemo(
    () => createPowerSyncDatabase({ web: { workerPath: POWERSYNC_WEB_WORKER_PATH } }),
    [],
  );

  useEffect(() => {
    let disposed = false;
    let unsubscribeOwnerToken: (() => void) | null = null;

    // Connect / disconnect from the owner-token state. The PowerSync v2 SDK
    // does not idle on null credentials: connect() while signed out spins its
    // sync loop, logging "Not signed in" every cycle. So: signed in ->
    // connect(); signed out -> disconnect() (offline, still usable locally).
    const setSyncFromAuth = async () => {
      const token = await getOwnerToken();
      if (disposed) return;
      if (token === null) {
        logger.info('powersync: no owner token — staying disconnected');
        try {
          await powersync.disconnect();
        } catch (error) {
          logger.warn('powersync disconnect failed', toError(error));
        }
        return;
      }
      // connect() re-disconnects any prior connect() itself; the SDK retries
      // rejections internally, so a rejection here is not fatal.
      powersync
        .connect(createPowerSyncConnector(getBackendConfig()))
        .catch((error: unknown) => {
          logger.error('powersync connect failed', toError(error));
        });
    };

    const start = async () => {
      try {
        await powersync.init();
      } catch (error) {
        logger.error('powersync init failed', toError(error));
        return;
      }
      if (disposed) return;
      // The single v1 stream (client-side subscription; the service
      // auto-subscribes too). Registered once, independent of auth. Failure
      // is not fatal: the sync loop retries on connect.
      //
      // The default contexts are seeded SERVER-SIDE (server/app/src/seed.ts,
      // single-writer) — the client no longer seeds. Client-side seeding was
      // racy: two fresh client DBs could both seed and upload two sets of
      // defaults, which then sync back to every client as duplicate tags.
      try {
        await subscribeAppStream(powersync);
      } catch (error) {
        logger.warn('stream subscription failed', toError(error));
      }
      if (disposed) return;
      // Drive the connection from the current token, then follow sign-in /
      // sign-out events for the life of the app.
      void setSyncFromAuth();
      unsubscribeOwnerToken = subscribeToOwnerTokenChange(() => {
        void setSyncFromAuth();
      });
    };
    void start();
    return () => {
      disposed = true;
      unsubscribeOwnerToken?.();
      void powersync.close().catch((error: unknown) => {
        logger.warn('powersync close failed', toError(error));
      });
    };
  }, [powersync]);

  return <PowerSyncContext.Provider value={powersync}>{children}</PowerSyncContext.Provider>;
}

/** Auth gate (prod-deploy R3): the root of the app is either loading
 *  (the startup pre-check is running), signed-out (the ConnectGate is
 *  shown INSTEAD of the app), or signed-in (the normal subtree). */
type AuthGateState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in' };

export default function RootLayout() {
  // Paper Serenity type (design §1.3): Epilogue for display, Plus Jakarta
  // Sans for body. Each weight is its own map key (the platform registers one
  // face per key — web @font-face / Android Typeface), plus the real family
  // names as entries so `fontFamily: 'Epilogue' | 'Plus Jakarta Sans'`
  // (tailwind `display` / `sans`) resolves on every platform: iOS matches the
  // fonts' internal family directly, web/android resolve the key.
  //
  // Web loads the SAME faces through the web font gate below (WEB_FONT_
  // FACES) instead of expo-font — hence the empty maps on web.
  const isWeb = !isReactNativeRuntime();
  const [epilogueLoaded, epilogueError] = useFonts(
    isWeb
      ? {}
      : {
          Epilogue: Epilogue_600SemiBold,
          Epilogue_500Medium,
          Epilogue_600SemiBold,
          Epilogue_700Bold,
        },
  );
  const [jakartaLoaded, jakartaError] = useFonts(
    isWeb
      ? {}
      : {
          'Plus Jakarta Sans': PlusJakartaSans_400Regular,
          PlusJakartaSans_400Regular,
          PlusJakartaSans_500Medium,
          PlusJakartaSans_600SemiBold,
          PlusJakartaSans_700Bold,
        },
  );

  // Web font gate (see the section above): every face loaded explicitly;
  // a failure logs and releases the gate on system fonts (the app must
  // never brick on a broken font).
  const [webFontsReady, setWebFontsReady] = useState(false);
  useEffect(() => {
    if (!isWeb) return;
    // Non-browser web runtimes (jest) have no FontFace API — there is
    // nothing to register, release the gate. Every real browser has it.
    if (typeof (globalThis as { FontFace?: unknown }).FontFace !== 'function') {
      setWebFontsReady(true);
      return;
    }
    let disposed = false;
    void (async () => {
      const results = await Promise.allSettled(
        WEB_FONT_FACES.map(([family, source]) =>
          withTimeout(loadWebFontFace(family, String(source)), WEB_FONT_TIMEOUT_MS, family),
        ),
      );
      const failures = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      if (disposed) return;
      if (failures.length > 0) {
        // One diagnostic line: a broken FETCH and a broken engine report
        // look identical from the gate, so probe the first face's URL and
        // log the UA (Tauri forwards console to its stdout in dev).
        const g = globalThis as unknown as {
          navigator: { userAgent: string };
          fetch(input: string): Promise<{ status: number }>;
        };
        const firstFailure = failures[0];
        if (firstFailure !== undefined) {
          const [firstFamily, firstSource] = WEB_FONT_FACES[0] ?? ['', ''];
          const probe = await g
            .fetch(String(firstSource))
            .then((r) => r.status)
            .catch((e: unknown) => String(e));
          logger.error(
            `web font load failed (${failures.length}/${WEB_FONT_FACES.length}; ` +
              `fetch probe ${firstFamily}=${probe}; ua=${g.navigator.userAgent})`,
            toError(firstFailure.reason),
          );
        }
      }
      setWebFontsReady(true);
    })();
    return () => {
      disposed = true;
    };
  }, [isWeb]);

  // A failed font load must not brick the app on the placeholder — log it and
  // fall back to the system fonts.
  useEffect(() => {
    if (epilogueError !== null) logger.error('Epilogue font load failed', epilogueError);
    if (jakartaError !== null) logger.error('Plus Jakarta Sans font load failed', jakartaError);
  }, [epilogueError, jakartaError]);

  /* ---------------- Auth gate (prod-deploy R3) ----------------
   *
   * The PowerSync v2 SDK swallows a 401 inside its retry loop (the
   * connector's `credentials.rejected` never surfaces to the app), so the
   * stored token's validity is validated ONCE at startup, before the app
   * renders:
   *
   *   startup → getOwnerToken()
   *     null            → Gate (signed out)
   *     token stored    → fetchCredentialsOnce(config, token)
   *       200           → the app (the provider connects via its
   *                       existing token-driven mechanism)
   *       401           → clearOwnerToken() + Gate (「token 无效」)
   *       network / 5xx → the app anyway (offline-first; the SDK retries
   *                       in the background — v1 has no in-session 401
   *                       awareness, a restart re-runs this check)
   *
   * After startup the gate only follows the owner-token CHANGE events
   * (the Gate's connect stores the token; a future sign-out clears it).
   */
  const [authGate, setAuthGate] = useState<AuthGateState>({ status: 'loading' });
  const [gateError, setGateError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const start = async () => {
      let token: string | null;
      try {
        token = await getOwnerToken();
      } catch (error) {
        // A storage failure is treated as signed-out: re-entering the
        // token on the Gate is the recovery path (never brick the app).
        logger.error('owner token read failed', toError(error));
        token = null;
      }
      if (disposed) return;
      if (token === null) {
        setAuthGate({ status: 'signed-out' });
        return;
      }
      const result = await fetchCredentialsOnce(getBackendConfig(), token);
      if (disposed) return;
      if (result.ok === false && result.kind === 'rejected' && result.status === 401) {
        setGateError('token 无效，请重新输入');
        try {
          await clearOwnerToken();
        } catch (error) {
          logger.error('owner token clear failed', toError(error));
        }
        setAuthGate({ status: 'signed-out' });
        return;
      }
      setAuthGate({ status: 'signed-in' });
    };
    void start();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToOwnerTokenChange(() => {
      void (async () => {
        let token: string | null;
        try {
          token = await getOwnerToken();
        } catch (error) {
          logger.error('owner token read failed', toError(error));
          token = null;
        }
        if (token === null) {
          setAuthGate({ status: 'signed-out' });
        } else {
          setGateError(null);
          setAuthGate({ status: 'signed-in' });
        }
      })();
    });
    return unsubscribe;
  }, []);

  // The Gate's connect handler: one /credentials round-trip, then store
  // the OWNER token (NOT the minted service JWT). The change notification
  // flips the gate AND drives the provider's connect() — one mechanism.
  const handleConnect = useCallback(async (rawToken: string): Promise<ConnectGateResult> => {
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
    if (result.kind === 'rejected' && result.status === 401) {
      return { ok: false, message: 'token 不正确' };
    }
    // Network failure / 5xx / malformed 200 body: the token is NOT
    // invalidated — the server is unreachable or unhealthy, retry later.
    return { ok: false, message: '连不上服务器，请稍后重试' };
  }, []);

  // Font gate: no `<Stack>` (a native) or web content until the faces are
  // registered — the placeholder (canvas background + centered label) is
  // what prevents a white flash; no native splash-screen module needed. A
  // failed load (native error !== null; web gate failure) releases the
  // gate: the app runs on system fonts.
  const fontsReady = isWeb
    ? webFontsReady
    : (epilogueLoaded || epilogueError !== null) &&
      (jakartaLoaded || jakartaError !== null);
  if (!fontsReady || authGate.status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-canvas dark:bg-canvas-dark">
        <Text className="text-base text-muted dark:text-muted-dark">加载中…</Text>
      </View>
    );
  }
  if (authGate.status === 'signed-out') {
    return <ConnectGate onConnect={handleConnect} initialError={gateError ?? undefined} />;
  }
  return (
    <PowerSyncProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </PowerSyncProvider>
  );
}
