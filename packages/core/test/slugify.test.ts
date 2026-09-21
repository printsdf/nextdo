import { describe, expect, it } from 'vitest';
import { SLUG_MAX_LENGTH, slugify, uniqueSlug } from '../src/lib/slugify';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips diacritics (ASCII transliteration)', () => {
    expect(slugify('Étude Café')).toBe('etude-cafe');
  });

  it('collapses separator runs and trims edge hyphens', () => {
    expect(slugify('A---B__C')).toBe('a-b-c');
    expect(slugify('  spaced out  ')).toBe('spaced-out');
  });

  it('drops non-ASCII characters', () => {
    expect(slugify('中文 Test 123')).toBe('test-123');
  });

  it('returns an empty string when no ASCII remains', () => {
    expect(slugify('中文')).toBe('');
  });

  it('truncates to the 50-character default without a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(40)}-${'b'.repeat(40)}`);
    expect(slug).toHaveLength(SLUG_MAX_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('respects a custom maxLength', () => {
    expect(slugify('hello-world', { maxLength: 5 })).toBe('hello');
  });
});

describe('uniqueSlug', () => {
  it('returns the base when it is free', () => {
    expect(uniqueSlug('task-1', [])).toBe('task-1');
  });

  it('appends -2, -3, ... until free', () => {
    expect(uniqueSlug('task-1', ['task-1'])).toBe('task-1-2');
    expect(uniqueSlug('task-1', ['task-1', 'task-1-2'])).toBe('task-1-3');
  });
});
