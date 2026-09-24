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
 * - Font gate (design §1.3): Epilogue + Plus Jakarta Sans load before the
 *   stack renders; until then a canvas placeholder stands in (no white
 *   flash, no `expo-splash-screen` dependency).
 */
import '../global.css';

import { useEffect, useMemo, type ReactNode } from 'react';
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
  createPowerSyncConnector,
  createPowerSyncDatabase,
  getOwnerToken,
  seedDefaultContexts,
  subscribeAppStream,
  subscribeToOwnerTokenChange,
  wrapDb,
} from '@nextdo/db';
import { logger } from '@nextdo/core';
import { POWERSYNC_WEB_WORKER_PATH, getBackendConfig } from '@/lib/env';

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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
      try {
        await subscribeAppStream(powersync);
      } catch (error) {
        logger.warn('stream subscription failed', toError(error));
      }
      if (disposed) return;
      // Default contexts for a FRESH database (design §6): seeds the five
      // spec contexts once, no-op otherwise (a user who deleted them all is
      // not re-seeded). Non-fatal — a failure must never block startup;
      // the user can still create contexts in the UI.
      try {
        await seedDefaultContexts(wrapDb(powersync), new Date());
      } catch (error) {
        logger.warn('context seeding failed', toError(error));
      }
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

export default function RootLayout() {
  // Paper Serenity type (design §1.3): Epilogue for display, Plus Jakarta
  // Sans for body. Each weight is its own map key (the platform registers one
  // face per key — web @font-face / Android Typeface), plus the real family
  // names as entries so `fontFamily: 'Epilogue' | 'Plus Jakarta Sans'`
  // (tailwind `display` / `sans`) resolves on every platform: iOS matches the
  // fonts' internal family directly, web/android resolve the key.
  const [epilogueLoaded, epilogueError] = useFonts({
    Epilogue: Epilogue_600SemiBold,
    Epilogue_500Medium,
    Epilogue_600SemiBold,
    Epilogue_700Bold,
  });
  const [jakartaLoaded, jakartaError] = useFonts({
    'Plus Jakarta Sans': PlusJakartaSans_400Regular,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  // A failed font load must not brick the app on the placeholder — log it and
  // fall back to the system fonts.
  useEffect(() => {
    if (epilogueError !== null) logger.error('Epilogue font load failed', epilogueError);
    if (jakartaError !== null) logger.error('Plus Jakarta Sans font load failed', jakartaError);
  }, [epilogueError, jakartaError]);

  // Font gate: no `<Stack>` (and no app content) until both families are
  // loaded — the placeholder (canvas background + centered label) is what
  // prevents a white flash; no native splash-screen module needed. A failed
  // load (error !== null) releases the gate: the app runs on system fonts.
  const fontsReady =
    (epilogueLoaded || epilogueError !== null) && (jakartaLoaded || jakartaError !== null);
  if (!fontsReady) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas dark:bg-canvas-dark">
        <Text className="text-base text-muted dark:text-muted-dark">加载中…</Text>
      </View>
    );
  }
  return (
    <PowerSyncProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </PowerSyncProvider>
  );
}
