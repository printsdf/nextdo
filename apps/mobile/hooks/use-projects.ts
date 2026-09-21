/**
 * Projects data hook: the non-deleted projects with the DERIVED
 * action-coverage flag (`hasOpenAction` — coverage is never stored,
 * domain-model.md) via the `packages/db` watched query.
 */
import { useMemo } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { projectsWatchQuery, wrapDb, type ProjectWithCoverage } from '@nextdo/db';

export interface UseProjectsResult {
  data: ProjectWithCoverage[];
  error: string | null;
}

export function useProjects(): UseProjectsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const { data, error } = useQuery(projectsWatchQuery(db));
  return { data, error: error === undefined ? null : String(error.message) };
}
