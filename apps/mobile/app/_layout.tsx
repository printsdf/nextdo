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
 */
import '../global.css';

import { useEffect, useMemo, type ReactNode } from 'react';
import { Stack } from 'expo-router';
import { PowerSyncContext } from '@powersync/react';
import {
  createPowerSyncConnector,
  createPowerSyncDatabase,
  getOwnerToken,
  subscribeAppStream,
  subscribeToOwnerTokenChange,
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
  return (
    <PowerSyncProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </PowerSyncProvider>
  );
}
