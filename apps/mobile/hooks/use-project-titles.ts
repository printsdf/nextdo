/**
 * Project titles (Now screen recommendation subtitle "项目 · 截止"): the
 * engine's candidates only carry `projectId`, so the screen resolves the
 * display name client-side. Query-style by design (design.md §5 — the
 * projects watch query already feeds the Projects tab; a second
 * subscription would be redundant, personal-scale data).
 */
import { useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { listProjects, wrapDb } from '@nextdo/db';
import { logger } from '@nextdo/core';

let cachedProjectTitles: Record<string, string> = {};

/** Test hook: reset module cache between test runs. */
export function __clearProjectTitlesCacheForTests(): void {
  cachedProjectTitles = {};
}

export function useProjectTitles(): Record<string, string> {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const [titles, setTitles] = useState<Record<string, string>>(() => cachedProjectTitles);

  useEffect(() => {
    let cancelled = false;
    listProjects(db)
      .then((projects) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const project of projects) map[project.id] = project.title;
        cachedProjectTitles = map;
        setTitles(map);
      })
      .catch((err: unknown) => {
        // Non-fatal: the subtitle simply omits the project name.
        if (cancelled) return;
        logger.warn('project titles query failed', err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
    };
  }, [db]);

  return titles;
}
