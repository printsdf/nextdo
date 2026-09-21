import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, DB_FILENAME } from '../src/constants/schema-version';
import { AGENT_TYPES } from '../src/constants/agent-types';
import { TASK_STATUSES, TASK_PRIORITIES, TASK_SOURCES } from '../src/constants/task-statuses';
import {
  DEFAULT_TASK_TYPE,
  TASK_TYPES,
  TASK_TYPE_DEFAULT_SKILLS,
  TASK_ARTIFACT_KINDS,
} from '../src/constants/task-types';

describe('schema version', () => {
  it('is v1 with the canonical db filename', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(DB_FILENAME).toBe('nextdo.db');
  });
});

describe('agent types', () => {
  it('defines the five agent types', () => {
    expect(AGENT_TYPES).toEqual(['main', 'planner', 'worker', 'reviewer', 'researcher']);
  });
});

describe('task statuses', () => {
  it('defines the seven task statuses', () => {
    expect(TASK_STATUSES).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'in_review',
      'done',
      'blocked',
      'cancelled',
    ]);
  });

  it('defines priorities and sources', () => {
    expect(TASK_PRIORITIES).toEqual(['low', 'medium', 'high', 'urgent']);
    expect(TASK_SOURCES).toEqual(['user', 'agent']);
  });
});

describe('task types', () => {
  it('defines the six task types with a default of other', () => {
    expect(TASK_TYPES).toEqual(['code', 'doc', 'data', 'research', 'ops', 'other']);
    expect(DEFAULT_TASK_TYPE).toBe('other');
  });

  it('maps every task type to a default skill (or null)', () => {
    for (const type of TASK_TYPES) {
      const skill = TASK_TYPE_DEFAULT_SKILLS[type];
      expect(skill === null || typeof skill === 'string').toBe(true);
    }
    expect(TASK_TYPE_DEFAULT_SKILLS.research).toBeNull();
    expect(TASK_TYPE_DEFAULT_SKILLS.other).toBeNull();
    expect(TASK_TYPE_DEFAULT_SKILLS.code).toBe('code');
    expect(Object.keys(TASK_TYPE_DEFAULT_SKILLS).sort()).toEqual([...TASK_TYPES].sort());
  });

  it('defines artifact kinds', () => {
    expect(TASK_ARTIFACT_KINDS).toEqual(['code', 'doc', 'data', 'config', 'other']);
  });
});
