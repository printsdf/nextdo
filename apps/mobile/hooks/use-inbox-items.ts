/**
 * Inbox data hook: the open, non-deleted InboxItems (oldest first) via the
 * `packages/db` watched query. Live-updates on table changes — the hook
 * owns the `@powersync/react` subscription (hook-guidelines).
 */
import { useMemo } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { inboxItemsWatchQuery, wrapDb } from '@nextdo/db';
import type { InboxItem } from '@nextdo/core';

export interface UseInboxItemsResult {
  data: InboxItem[];
  error: string | null;
}

export function useInboxItems(): UseInboxItemsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const { data, error } = useQuery(inboxItemsWatchQuery(db));
  // `@powersync/react` types `error` as `Error | undefined` but delivers
  // `null` at runtime (watch state) — a truthy check, not `=== undefined`.
  return { data, error: error ? String(error.message) : null };
}
