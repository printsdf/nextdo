/**
 * The single logger (spec: project/conventions.md §Logging).
 *
 * Wraps console and is the only allowed logging path — apps and packages
 * import `logger` and never touch console (enforced by ESLint no-console,
 * with this file as the one exception).
 *
 * Rules: log what happened (not stack traces of expected control flow);
 * never log user free-text content (inbox items contain personal data).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function emit(level: LogLevel, message: string, extra?: unknown): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}`;
  if (level === 'error') {
    // errors are always paired with an error object
    console.error(line, extra !== undefined ? extra : new Error(message));
  } else if (extra !== undefined) {
    console.log(line, extra);
  } else {
    console.log(line);
  }
}

export const logger = {
  /** Dev-only diagnostics; stripped at release-build level by setLogLevel. */
  debug: (message: string, extra?: unknown): void => emit('debug', message, extra),
  /** Lifecycle: sync connect/disconnect, focus session start/end. */
  info: (message: string, extra?: unknown): void => emit('info', message, extra),
  /** Recoverable: skipped action, conflict resolved. */
  warn: (message: string, extra?: unknown): void => emit('warn', message, extra),
  /** Always paired with an error object. */
  error: (message: string, error?: unknown): void => emit('error', message, error),
};
