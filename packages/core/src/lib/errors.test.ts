import {
  EngineNextdoError,
  NextdoError,
  StorageNextdoError,
  SyncNextdoError,
  ValidationNextdoError,
} from './errors';

describe('NextdoError hierarchy', () => {
  it('carries a stable code and keeps the message', () => {
    const err = new ValidationNextdoError('project.needs-outcome', 'A project requires an outcome');
    expect(err.code).toBe('project.needs-outcome');
    expect(err.message).toBe('A project requires an outcome');
    expect(err).toBeInstanceOf(Error);
  });

  it('names itself after the subclass', () => {
    expect(new ValidationNextdoError('c', 'm').name).toBe('ValidationNextdoError');
    expect(new SyncNextdoError('c', 'm').name).toBe('SyncNextdoError');
    expect(new EngineNextdoError('c', 'm').name).toBe('EngineNextdoError');
    expect(new StorageNextdoError('c', 'm').name).toBe('StorageNextdoError');
  });

  it('all subclasses extend NextdoError', () => {
    for (const err of [
      new ValidationNextdoError('c', 'm'),
      new SyncNextdoError('c', 'm'),
      new EngineNextdoError('c', 'm'),
      new StorageNextdoError('c', 'm'),
    ]) {
      expect(err).toBeInstanceOf(NextdoError);
    }
  });
});
