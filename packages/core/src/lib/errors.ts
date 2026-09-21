import type { ErrorEvent } from '../types/events';

/**
 * Unified error hierarchy.
 *
 * All application errors extend NextdoError so the IPC layer and the
 * event bus can shape them uniformly (see toErrorEvent).
 */
export class NextdoError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class ConfigError extends NextdoError {}

export class StorageError extends NextdoError {}

export class AgentError extends NextdoError {}

export class IpcError extends NextdoError {}

export class NotFoundError extends NextdoError {}

/** Convert an Error into the EventBus `error` payload shape. */
export function toErrorEvent(error: Error, code?: string): ErrorEvent {
  const base: ErrorEvent = {
    kind: 'error',
    name: error.name,
    message: error.message,
    timestamp: new Date().toISOString(),
    stack: error.stack,
  };
  if (error instanceof NextdoError) {
    return { ...base, code: code ?? error.code, details: error.details };
  }
  return code !== undefined ? { ...base, code } : base;
}
