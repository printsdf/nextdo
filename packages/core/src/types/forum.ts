import type { AuthorType } from './task';

/**
 * Forum post (forum table).
 */
export interface ForumPost {
  id: string;
  title: string;
  content: string;
  authorType: AuthorType;
  authorId?: string;
  tags: string[];
  channelRef?: string;
  taskId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Forum reply (forum_reply table). Replies may be produced by an
 * agent running a skill on the post.
 */
export interface ForumReply {
  id: string;
  forumId: string;
  content: string;
  authorType: AuthorType;
  authorId?: string;
  skill?: string;
  agentRunId?: string;
  createdAt: string;
}
