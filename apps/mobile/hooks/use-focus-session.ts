/**
 * Focus-session hook (focus screen, design.md §4.6): the ONE home for the
 * session lifecycle the screen drives —
 *
 * - `start(mode, plannedMinutes)` → packages/db `startFocusSession`
 * - `recordPause(totalPausedSec)` → absolute accumulated total (db contract)
 * - `complete()` → `completeFocusSession` (session only — the action is
 *   completed separately via the canonical complete transaction)
 * - `abandon()` → `abandonFocusSession` (the action stays untouched)
 *
 * plus the re-entry read: the action's `active` session (if any), so a
 * killed app resumes the running timer. Every `now` comes from the single
 * app clock (hook-guidelines Rule 4) — the screen's 1-second tick is
 * display-only and never feeds these.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import {
  abandonFocusSession,
  completeFocusSession,
  listFocusSessions,
  recordPause as recordPauseDb,
  startFocusSession,
  wrapDb,
  type ActionKind,
} from '@nextdo/db';
import { logger, type FocusSession } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface UseFocusSessionResult {
  /** The action's live (active) session, or null. null until `loaded`. */
  activeSession: FocusSession | null;
  loaded: boolean;
  error: string | null;
  start: (args: { actionId: string; actionKind: ActionKind; minutes: number | null }) => Promise<FocusSession | null>;
  recordPause: (sessionId: string, totalPausedSec: number) => Promise<void>;
  complete: (sessionId: string) => Promise<void>;
  abandon: (sessionId: string) => Promise<void>;
}

export function useFocusSession(actionId: string | null): UseFocusSessionResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [activeSession, setActiveSession] = useState<FocusSession | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-entry recovery: the active session row (startedAt/pausedSec live in it).
  useEffect(() => {
    if (actionId === null) return;
    let cancelled = false;
    listFocusSessions(db, { actionId })
      .then((sessions) => {
        if (cancelled) return;
        setActiveSession(sessions.find((session) => session.status === 'active') ?? null);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error('focus session query failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [db, actionId]);

  const start = useCallback(
    async (args: { actionId: string; actionKind: ActionKind; minutes: number | null }) => {
      try {
        const session = await startFocusSession(db, {
          actionId: args.actionId,
          actionKind: args.actionKind,
          mode: args.minutes === null ? 'free' : 'preset',
          plannedMinutes: args.minutes,
          now,
        });
        setActiveSession(session);
        setError(null);
        return session;
      } catch (err: unknown) {
        logger.error('focus session start failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [db, now],
  );

  const recordPause = useCallback(
    async (sessionId: string, totalPausedSec: number) => {
      try {
        const updated = await recordPauseDb(db, { sessionId, pausedSec: totalPausedSec, now });
        setActiveSession((current) => (current?.id === sessionId ? updated : current));
        setError(null);
      } catch (err: unknown) {
        logger.error('focus pause failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [db, now],
  );

  const complete = useCallback(
    async (sessionId: string) => {
      try {
        await completeFocusSession(db, { sessionId, now });
        setError(null);
      } catch (err: unknown) {
        logger.error('focus session complete failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [db, now],
  );

  const abandon = useCallback(
    async (sessionId: string) => {
      try {
        await abandonFocusSession(db, { sessionId, now });
        setError(null);
      } catch (err: unknown) {
        logger.error('focus session abandon failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [db, now],
  );

  return { activeSession, loaded, error, start, recordPause, complete, abandon };
}
