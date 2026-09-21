import { describe, expect, it } from 'vitest';
import { createNextdoPaths } from '../src/lib/paths';

describe('createNextdoPaths', () => {
  it('derives the full layout from a root without trailing slash', () => {
    const paths = createNextdoPaths('/Users/u/.nextdo');
    expect(paths).toEqual({
      root: '/Users/u/.nextdo/',
      db: '/Users/u/.nextdo/nextdo.db',
      skills: '/Users/u/.nextdo/skills/',
      workspace: '/Users/u/.nextdo/workspace/',
      tasks: '/Users/u/.nextdo/tasks/',
      forum: '/Users/u/.nextdo/forum/',
      notes: '/Users/u/.nextdo/notes/',
      desktopLogs: '/Users/u/.nextdo/logs/desktop/',
      mobileLogs: '/Users/u/.nextdo/logs/mobile/',
    });
  });

  it('does not double the slash when the root already ends with one', () => {
    const paths = createNextdoPaths('/home/u/.nextdo/');
    expect(paths.root).toBe('/home/u/.nextdo/');
    expect(paths.db).toBe('/home/u/.nextdo/nextdo.db');
  });

  it('db is a file path, everything else a directory', () => {
    const paths = createNextdoPaths('~/.nextdo');
    expect(paths.db.endsWith('/')).toBe(false);
    for (const key of ['skills', 'workspace', 'tasks', 'forum', 'notes', 'desktopLogs', 'mobileLogs'] as const) {
      expect(paths[key].endsWith('/')).toBe(true);
    }
  });
});
