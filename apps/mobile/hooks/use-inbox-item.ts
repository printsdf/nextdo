/**
 * Single InboxItem loader for the Clarify screen (design.md §4.3): the
 * wizard needs the item's title (every form field's default). Loads once
 * per id through the canonical list query — no per-id query in packages/db
 * (the db delta for this task is fixed; personal-scale data).
 *
 * `loaded` distinguishes "still fetching" from "fetched but gone" (the
 * screen shows a not-found state + back, never an infinite spinner).
 */
import { useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { listInboxItems, wrapDb } from '@nextdo/db';
import { logger, type InboxItem } from '@nextdo/core';

export interface UseInboxItemResult {
  item: InboxItem | null;
  loaded: boolean;
  error: string | null;
}

export function useInboxItem(inboxId: string | null): UseInboxItemResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const [item, setItem] = useState<InboxItem | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (inboxId === null) return;
    let cancelled = false;
    setItem(null);
    setLoaded(false);
    setError(null);
    listInboxItems(db)
      .then((items) => {
        if (cancelled) return;
        setItem(items.find((candidate) => candidate.id === inboxId) ?? null);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error('inbox item load failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [db, inboxId]);

  return { item, loaded, error };
}
