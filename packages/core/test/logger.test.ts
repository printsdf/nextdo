import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger, getLogLevel, loggerFor, setLogLevel } from '../src/lib/logger';

function makeSpies() {
  return {
    debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  };
}

describe('Logger', () => {
  let spies: ReturnType<typeof makeSpies>;

  beforeEach(() => {
    setLogLevel('info');
    spies = makeSpies();
  });

  afterEach(() => {
    for (const spy of Object.values(spies)) spy.mockRestore();
  });

  it('logs info messages with timestamp, level, namespace and message', () => {
    const logger = new Logger('nextdo:test');
    logger.info('hello');
    const line = spies.info.mock.calls[0]?.[0] as string;
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO\s+\[nextdo:test\] hello$/);
  });

  it('filters out levels below the threshold', () => {
    const logger = new Logger('nextdo:test');
    logger.debug('nope');
    expect(spies.debug).not.toHaveBeenCalled();
  });

  it('honors the global level after setLogLevel', () => {
    setLogLevel('debug');
    loggerFor('nextdo:glob').debug('yes');
    expect(spies.debug).toHaveBeenCalledOnce();
    expect(getLogLevel()).toBe('debug');
  });

  it('appends meta as JSON', () => {
    const logger = new Logger('nextdo:test');
    logger.warn('oops', { taskId: 't1' });
    const line = spies.warn.mock.calls[0]?.[0] as string;
    expect(line).toContain('oops {"taskId":"t1"}');
  });

  it('builds child namespaces', () => {
    const child = new Logger('a').child('b');
    child.info('x');
    const line = spies.info.mock.calls[0]?.[0] as string;
    expect(line).toContain('[a:b]');
  });

  it('loggerFor returns singletons per namespace', () => {
    expect(loggerFor('nextdo:same')).toBe(loggerFor('nextdo:same'));
    expect(loggerFor('nextdo:same')).not.toBe(loggerFor('nextdo:other'));
  });
});
