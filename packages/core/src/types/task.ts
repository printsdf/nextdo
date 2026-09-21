import type { TaskStatus, TaskPriority, TaskSource } from '../constants/task-statuses';
import type { TaskArtifactKind } from '../constants/task-types';

export const AUTHOR_TYPES = ['user', 'agent', 'system'] as const;
export type AuthorType = (typeof AUTHOR_TYPES)[number];

/**
 * Task entity (tasks table). `content` is the body; `description` is a
 * short summary. `workspace` is the workspace key (slug) and
 * `workspacePath` the absolute filesystem path under it.
 */
export interface Task {
  id: string;
  title: string;
  content?: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];
  skill?: string;
  source: TaskSource;
  parentTaskId?: string;
  sourceMessageId?: string;
  sourceThreadId?: string;
  workspace: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Append-only status history (task_status table).
 */
export interface TaskStatusRecord {
  id: string;
  taskId: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  reason?: string;
  source: TaskSource;
  agentRunId?: string;
  createdAt: string;
}

/**
 * Task comment (task_comment table).
 */
export interface TaskComment {
  id: string;
  taskId: string;
  content: string;
  authorType: AuthorType;
  authorId?: string;
  skill?: string;
  agentRunId?: string;
  createdAt: string;
}

/**
 * Task artifact (task_artifact table). `path` is relative to the
 * workspace root.
 */
export interface TaskArtifact {
  id: string;
  taskId: string;
  agentRunId?: string;
  path: string;
  kind: TaskArtifactKind;
  description?: string;
  createdAt: string;
}
