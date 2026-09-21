import type { TaskStatus, TaskPriority, TaskSource } from '../constants/task-statuses';
import type { SkillStatus } from './skill';
import type { MessageType } from './channel';

/**
 * IPC command/response contracts between desktop/mobile UI and the
 * server/app daemon. Commands are a discriminated union on `cmd`;
 * add new members as features land.
 */

export interface IpcErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface IpcResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: IpcErrorBody;
}

// --- app -----------------------------------------------------------------

export interface CommandPing {
  cmd: 'ping';
  nonce?: string;
}

export interface PongData {
  serverTime: string;
  version: string;
}

// --- tasks ----------------------------------------------------------------

export interface TaskFilter {
  status?: TaskStatus;
  priority?: TaskPriority;
  tags?: string[];
  workspace?: string;
  parentTaskId?: string | null;
}

export interface CommandTaskList {
  cmd: 'task.list';
  filter?: TaskFilter;
  limit?: number;
}

export interface CommandTaskGet {
  cmd: 'task.get';
  taskId: string;
}

export interface NewTaskInput {
  title: string;
  content?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  tags?: string[];
  skill?: string;
  source?: TaskSource;
  parentTaskId?: string;
  sourceMessageId?: string;
  sourceThreadId?: string;
  workspace: string;
  workspacePath: string;
}

export interface CommandTaskCreate {
  cmd: 'task.create';
  input: NewTaskInput;
}

export interface CommandTaskUpdate {
  cmd: 'task.update';
  taskId: string;
  patch: Partial<NewTaskInput>;
}

export interface CommandTaskDelete {
  cmd: 'task.delete';
  taskId: string;
}

export interface CommandTaskStatusList {
  cmd: 'task.status.list';
  taskId: string;
}

export interface CommandTaskCommentList {
  cmd: 'task.comment.list';
  taskId: string;
}

export interface CommandTaskArtifactList {
  cmd: 'task.artifact.list';
  taskId: string;
}

// --- channels / messages ----------------------------------------------------

export interface CommandChannelList {
  cmd: 'channel.list';
}

export interface CommandMessageList {
  cmd: 'message.list';
  channelId: string;
  before?: string;
  limit?: number;
}

export interface CommandMessageSend {
  cmd: 'message.send';
  channelId: string;
  content: string;
  messageType?: MessageType;
}

// --- skills ------------------------------------------------------------------

export interface CommandSkillList {
  cmd: 'skill.list';
  status?: SkillStatus;
}

export interface CommandSkillGet {
  cmd: 'skill.get';
  skillId: string;
}

// --- agents ------------------------------------------------------------------

export interface CommandAgentStart {
  cmd: 'agent.start';
  taskId: string;
  agentId?: string;
}

export interface CommandAgentRunGet {
  cmd: 'agent.run.get';
  agentRunId: string;
}

export interface CommandAgentPause {
  cmd: 'agent.pause';
  agentRunId: string;
}

export interface CommandAgentCancel {
  cmd: 'agent.cancel';
  agentRunId: string;
}

// --- sync / audit ---------------------------------------------------------------

export interface CommandSyncState {
  cmd: 'sync.state';
}

export interface CommandAuditList {
  cmd: 'audit.list';
  limit?: number;
  beforeId?: string;
}

export type IpcCommand =
  | CommandPing
  | CommandTaskList
  | CommandTaskGet
  | CommandTaskCreate
  | CommandTaskUpdate
  | CommandTaskDelete
  | CommandTaskStatusList
  | CommandTaskCommentList
  | CommandTaskArtifactList
  | CommandChannelList
  | CommandMessageList
  | CommandMessageSend
  | CommandSkillList
  | CommandSkillGet
  | CommandAgentStart
  | CommandAgentRunGet
  | CommandAgentPause
  | CommandAgentCancel
  | CommandSyncState
  | CommandAuditList;
