export const EVENT_TYPES = [
  'message.new',
  'channel.joined',
  'agent.started',
  'agent.message',
  'task.created',
  'task.status_changed',
  'skill.completed',
  'error',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Domain event (event table). `payload` is a JSON string.
 *
 * Named AppEvent to avoid clashing with the DOM Event global.
 */
export interface AppEvent {
  id: string;
  type: EventType;
  payload: string;
  source: string;
  timestamp: string;
}

/**
 * Persisted event-bus entry (event_bus table). `processed` marks
 * entries already consumed by subscribers; unprocessed entries are
 * replayed on daemon restart.
 */
export interface EventBusEntry {
  id: string;
  topic: string;
  payload: string;
  source: string;
  timestamp: string;
  processed: boolean;
}

/**
 * Payload shape for events of type 'error'.
 */
export interface ErrorEvent {
  kind: 'error';
  name: string;
  code?: string;
  message: string;
  details?: Record<string, unknown>;
  stack?: string;
  timestamp: string;
}
