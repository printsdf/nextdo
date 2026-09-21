import { describe, expect, it } from 'vitest';
import {
  AgentError,
  ConfigError,
  IpcError,
  NextdoError,
  NotFoundError,
  StorageError,
  toErrorEvent,
} from '../src/lib/errors';

describe('error hierarchy', () => {
  it('subclasses extend NextdoError and Error', () => {
    const err = new StorageError('db.corrupt', 'cannot open db');
    expect(err).toBeInstanceOf(StorageError);
    expect(err).toBeInstanceOf(NextdoError);
    expect(err).toBeInstanceOf(Error);
  });

  it('sets name to the subclass name and carries code/details', () => {
    const err = new ConfigError('config.missing', 'no config', { file: 'a.json' });
    expect(err.name).toBe('ConfigError');
    expect(err.code).toBe('config.missing');
    expect(err.details).toEqual({ file: 'a.json' });
  });

  it('covers the full hierarchy', () => {
    expect(new ConfigError('c', 'm')).toBeInstanceOf(NextdoError);
    expect(new AgentError('a', 'm')).toBeInstanceOf(NextdoError);
    expect(new IpcError('i', 'm')).toBeInstanceOf(NextdoError);
    expect(new NotFoundError('n', 'm')).toBeInstanceOf(NextdoError);
  });
});

describe('toErrorEvent', () => {
  it('maps NextdoError fields into the error event shape', () => {
    const event = toErrorEvent(new StorageError('db.corrupt', 'boom', { line: 3 }));
    expect(event.kind).toBe('error');
    expect(event.name).toBe('StorageError');
    expect(event.code).toBe('db.corrupt');
    expect(event.message).toBe('boom');
    expect(event.details).toEqual({ line: 3 });
    expect(event.timestamp).toMatch(/^\d{4}-/);
  });

  it('handles plain Error without a code', () => {
    const event = toErrorEvent(new Error('plain'));
    expect(event.name).toBe('Error');
    expect(event.code).toBeUndefined();
    expect(event.details).toBeUndefined();
  });

  it('accepts an explicit code override', () => {
    const event = toErrorEvent(new Error('plain'), 'custom.code');
    expect(event.code).toBe('custom.code');
  });
});
