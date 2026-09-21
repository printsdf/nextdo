/**
 * Query tests — Projects + action-coverage derivation
 * (spec: domain/domain-model.md "Project" — "Coverage is always derived,
 * never stored").
 */
import { toIso, ulid, type Project, type Value } from '@nextdo/core';
import { completeAction } from '../queries/actions';
import {
  addProject,
  getProjectCoverage,
  listProjects,
  projectActionCoverage,
  trashProject,
  updateProject,
} from '../queries/projects';
import { openTestDb, type TestDb } from './query-helpers';
import { FIXTURE_IDS, FIXTURE_NOW } from './fixtures';

const P = FIXTURE_IDS.projects;

let env: TestDb | null = null;
afterEach(async () => {
  if (env !== null) {
    await env.close();
    env = null;
  }
});
async function open(seed = false, now: Date = FIXTURE_NOW): Promise<TestDb> {
  env = await openTestDb(seed, now);
  return env;
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: ulid(FIXTURE_NOW),
    createdAt: toIso(FIXTURE_NOW),
    updatedAt: toIso(FIXTURE_NOW),
    deletedAt: null,
    title: '新项目',
    outcome: '完成它',
    value: 3 as Value,
    status: 'active',
    ...overrides,
  };
}

describe('CRUD', () => {
  it('lists [] on an empty database', async () => {
    const { db, close } = await open();
    try {
      expect(await listProjects(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('lists live projects ordered by created_at', async () => {
    const { db, close } = await open(true);
    try {
      const list = await listProjects(db);
      expect(list).toHaveLength(3);
      expect(list.map((project) => project.id)).toEqual([P.held, P.paper, P.empty]);
    } finally {
      await close();
    }
  });

  it('add: inserts a valid project; rejects a missing outcome', async () => {
    const { db, close } = await open();
    try {
      const project = makeProject();
      await addProject(db, project);
      expect(await listProjects(db)).toEqual([project]);
      await expect(addProject(db, makeProject({ outcome: '  ' }))).rejects.toMatchObject({
        code: 'project.needs-outcome',
      });
    } finally {
      await close();
    }
  });

  it('update: active → on-hold is a legal transition', async () => {
    const { db, close } = await open(true);
    try {
      const held = (await listProjects(db)).find((project) => project.id === P.paper);
      await updateProject(db, { ...(held as Project), status: 'on-hold', updatedAt: toIso(FIXTURE_NOW) });
      const reloaded = (await listProjects(db)).find((project) => project.id === P.paper);
      expect(reloaded?.status).toBe('on-hold');
    } finally {
      await close();
    }
  });

  it('update: done is terminal (done → active is illegal)', async () => {
    const { db, close } = await open();
    try {
      const project = makeProject();
      await addProject(db, project);
      await updateProject(db, { ...project, status: 'done', updatedAt: toIso(FIXTURE_NOW) });
      await expect(
        updateProject(db, { ...project, status: 'active', updatedAt: toIso(FIXTURE_NOW) }),
      ).rejects.toMatchObject({ code: 'invalid-transition:done:active' });
    } finally {
      await close();
    }
  });

  it('update: throws not-found for a missing project', async () => {
    const { db, close } = await open(true);
    try {
      await expect(updateProject(db, makeProject())).rejects.toMatchObject({ code: 'project.not-found' });
    } finally {
      await close();
    }
  });

  it('trash: soft-deletes; a second trash throws not-found', async () => {
    const { db, close } = await open();
    try {
      const project = makeProject();
      await addProject(db, project);
      await trashProject(db, { id: project.id, now: FIXTURE_NOW });
      expect(await listProjects(db)).toEqual([]);
      await expect(trashProject(db, { id: project.id, now: FIXTURE_NOW })).rejects.toMatchObject({
        code: 'project.not-found',
      });
    } finally {
      await close();
    }
  });
});

describe('coverage (derived, never stored)', () => {
  it('getProjectCoverage: true with an open action, false without', async () => {
    const { db, close } = await open(true);
    try {
      expect(await getProjectCoverage(db, P.paper)).toBe(true);
      expect(await getProjectCoverage(db, P.empty)).toBe(false);
    } finally {
      await close();
    }
  });

  it('getProjectCoverage: throws not-found for a missing project', async () => {
    const { db, close } = await open(true);
    try {
      await expect(getProjectCoverage(db, '01TST0000000000000000000099')).rejects.toMatchObject({
        code: 'project.not-found',
      });
    } finally {
      await close();
    }
  });

  it('projectActionCoverage: the active projects lacking an open action', async () => {
    const { db, close } = await open(true);
    try {
      // paper is covered; held is on-hold (not reported); empty is the only
      // active uncovered project.
      expect((await projectActionCoverage(db)).map((project) => project.id)).toEqual([P.empty]);
    } finally {
      await close();
    }
  });

  it('coverage re-derives after the last action completes (no stored counter)', async () => {
    const { db, close } = await open(true);
    try {
      // paper has exactly two open actions (A.b, A.depDone) — complete both
      // via the canonical transaction and the project becomes uncovered.
      await completeAction(db, { actionKind: 'next', actionId: FIXTURE_IDS.actions.b, now: FIXTURE_NOW });
      await completeAction(db, {
        actionKind: 'next',
        actionId: FIXTURE_IDS.actions.depDone,
        now: FIXTURE_NOW,
      });
      expect(await getProjectCoverage(db, P.paper)).toBe(false);
      expect((await projectActionCoverage(db)).map((project) => project.id).sort()).toEqual(
        [P.paper, P.empty].sort(),
      );
    } finally {
      await close();
    }
  });
});
