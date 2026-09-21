export const TASK_TYPES = ['code', 'doc', 'data', 'research', 'ops', 'other'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const DEFAULT_TASK_TYPE: TaskType = 'other';

/**
 * Default skill suggestion per task type (null = no default).
 */
export const TASK_TYPE_DEFAULT_SKILLS: Record<TaskType, string | null> = {
  code: 'code',
  doc: 'writing',
  data: 'data-analysis',
  research: null,
  ops: 'ops',
  other: null,
};

export const TASK_ARTIFACT_KINDS = ['code', 'doc', 'data', 'config', 'other'] as const;
export type TaskArtifactKind = (typeof TASK_ARTIFACT_KINDS)[number];
