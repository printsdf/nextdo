/**
 * Level-based namespaced logger.
 *
 * Pure (no Node builtins) so it can be imported from any runtime
 * (Node server, Tauri desktop, Expo mobile). The default level is
 * 'info'; entry points (server/app, desktop, mobile) call
 * setLogLevel() at startup. console.* is the only sanctioned output
 * channel in this codebase (enforced by ESLint no-console).
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let globalLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

export function getLogLevel(): LogLevel {
  return globalLevel;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export class Logger {
  private readonly namespace: string;
  private readonly levelOverride: LogLevel | null;

  constructor(namespace: string, level: LogLevel | null = null) {
    this.namespace = namespace;
    this.levelOverride = level;
  }

  /** Effective level: explicit override wins, otherwise the global level. */
  get level(): LogLevel {
    return this.levelOverride ?? globalLevel;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write('error', message, meta);
  }

  /** Child logger with a dotted namespace (`a` → `a:b`). */
  child(namespace: string): Logger {
    return new Logger(`${this.namespace}:${namespace}`, this.levelOverride);
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.level]) return;
    const suffix = meta !== undefined ? ` ${safeStringify(meta)}` : '';
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${this.namespace}] ${message}${suffix}`;
    switch (level) {
      case 'debug':
        console.debug(line);
        break;
      case 'info':
        console.info(line);
        break;
      case 'warn':
        console.warn(line);
        break;
      case 'error':
        console.error(line);
        break;
    }
  }
}

const cache = new Map<string, Logger>();

/**
 * Singleton logger per namespace (and explicit level, when given).
 */
export function loggerFor(namespace: string, level?: LogLevel): Logger {
  const key = level === undefined ? namespace : `${namespace}@${level}`;
  let logger = cache.get(key);
  if (logger === undefined) {
    logger = new Logger(namespace, level ?? null);
    cache.set(key, logger);
  }
  return logger;
}
