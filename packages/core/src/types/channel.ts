export const CHANNEL_VISIBILITIES = ['private', 'workspace', 'public'] as const;
export type ChannelVisibility = (typeof CHANNEL_VISIBILITIES)[number];

export const CHANNEL_ROLES = ['owner', 'admin', 'member', 'guest'] as const;
export type ChannelRole = (typeof CHANNEL_ROLES)[number];

export const MESSAGE_TYPES = ['text', 'code', 'file', 'image', 'link', 'mention'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const SENDER_TYPES = ['user', 'agent'] as const;
export type SenderType = (typeof SENDER_TYPES)[number];

/**
 * Channel entity (channel table).
 */
export interface Channel {
  id: string;
  name: string;
  description?: string;
  visibility: ChannelVisibility;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Channel membership (member table). Exactly one of agentId/userId
 * is set.
 */
export interface Member {
  id: string;
  channelId: string;
  agentId?: string;
  userId?: string;
  role: ChannelRole;
  joinedAt: string;
}

/**
 * Channel message (message table). `replyTo` links to a parent
 * message; `threadId` groups replies into a thread.
 */
export interface Message {
  id: string;
  channelId: string;
  senderType: SenderType;
  senderId: string;
  content: string;
  messageType: MessageType;
  replyTo?: string;
  threadId?: string;
  createdAt: string;
  editedAt?: string;
}

/**
 * Thread (thread table), rooted at a parent message.
 */
export interface Thread {
  id: string;
  channelId: string;
  parentMessageId: string;
  title?: string;
  createdBy: string;
  createdAt: string;
}
