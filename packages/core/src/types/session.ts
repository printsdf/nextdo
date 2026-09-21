export const SESSION_TYPES = ['desktop', 'mobile'] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

/**
 * Client session (session table).
 */
export interface Session {
  id: string;
  userId: string;
  type: SessionType;
  deviceId: string;
  startedAt: string;
  lastActiveAt: string;
}
