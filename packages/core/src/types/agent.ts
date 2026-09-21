import type { AgentType } from '../constants/agent-types';

export const AGENT_RUN_STATUSES = ['pending', 'running', 'paused', 'failed', 'completed'] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const SKILL_RUN_STATUSES = ['running', 'completed', 'failed'] as const;
export type SkillRunStatus = (typeof SKILL_RUN_STATUSES)[number];

export const AGENT_MESSAGE_ROLES = ['user', 'assistant', 'system', 'tool'] as const;
export type AgentMessageRole = (typeof AGENT_MESSAGE_ROLES)[number];

/**
 * Agent entity (agent table).
 */
export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  role: string;
  capabilities: string[];
  active: boolean;
  maxConcurrent: number;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One execution of an agent on a task (agent_run table).
 * `parentRunId` links spawned sub-runs to their parent.
 */
export interface AgentRun {
  id: string;
  agentId: string;
  taskId: string;
  parentRunId?: string;
  status: AgentRunStatus;
  skill?: string;
  inputSummary: string;
  outputSummary?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

/**
 * Message exchanged within an agent run (agent_message table).
 * `toolArgs` is the parsed tool-call argument object.
 */
export interface AgentMessage {
  id: string;
  runId: string;
  role: AgentMessageRole;
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  createdAt: string;
}

/**
 * Skill invocation within an agent run (skill_run table).
 */
export interface SkillRun {
  id: string;
  agentRunId: string;
  skill: string;
  version: string;
  status: SkillRunStatus;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

/**
 * Versioned snapshot of a skill (skill_version table).
 */
export interface SkillVersion {
  id: string;
  skillId: string;
  version: string;
  contentHash: string;
  changelog: string;
  createdAt: string;
}
