/**
 * Root layout (design.md §4): the PowerSync provider (the `packages/db`
 * platform client instance, connected once) + the navigation stack.
 *
 * - The instance is created once per app launch — it owns the local SQLite
 *   and the sync/upload loops.
 * - `connect()` is called with the `packages/db` connector built from the
 *   runtime backend config (`lib/env.ts`). When no owner token is stored the
 *   connector returns `null` credentials and the SDK simply stays
 *   disconnected — the app still works offline against the local DB.
 * - The single v1 stream is subscribed explicitly (the service declares it
 *   `auto_subscribe: true`; the stream name stays in `packages/db`).
 */
import '../global.css';

import { useEffect, useMemo, type ReactNode } from 'react';
import { Stack } from 'expo-router';
import { PowerSyncContext } from '@powersync/react';
import {
  createPowerSyncConnector,
  createPowerSyncDatabase,
  subscribeAppStream,
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
    const start = async () => {
      try {
        await powersync.init();
      } catch (error) {
        logger.error('powersync init failed', toError(error));
        return;
      }
      if (disposed) return;
      // The single v1 stream (safeguard — the service auto-subscribes too).
      // Failure is not fatal: the sync loop retries on connect.
      try {
        await subscribeAppStream(powersync);
      } catch (error) {
        logger.warn('stream subscription failed', toError(error));
      }
      if (disposed) return;
      // connect() drives the SDK's connection loop (credentials, sync,
      // upload). Rejections are retried by the SDK; log only.
      powersync
        .connect(createPowerSyncConnector(getBackendConfig()))
        .catch((error: unknown) => {
          logger.error('powersync connect failed', toError(error));
        });
    };
    void start();
    return () => {
      disposed = true;
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
