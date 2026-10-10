/**
 * `parseConnectionString` — the single parser behind both connection
 * string shapes (10-02-simplify-sync-setup, design D5):
 *
 *   deep link : nextdo://sync?s=<encoded base address>&t=<encoded token>
 *   plaintext : <base address>|<token>
 *
 * The load-bearing behavior is the NEGATIVE space: a bare owner token
 * must return null so the Settings tab keeps its pre-existing "this field
 * is just the token" fallback, and a half-filled string (a pipe with only
 * one side, a deep link missing `t`) must NOT parse into a half-config.
 * Pure and platform-free, so no mocks are needed here.
 */
import {
  formatConnectionString,
  formatDeepLink,
  parseConnectionString,
} from './sync-connection';

describe('plaintext `<base>|<token>`', () => {
  it('parses address + token', () => {
    expect(parseConnectionString('https://nextdo.example.com|abc123')).toEqual({
      serverAddress: 'https://nextdo.example.com',
      token: 'abc123',
    });
  });

  it('trims whitespace around both parts (terminal copy-paste)', () => {
    expect(parseConnectionString('  https://nextdo.example.com \n | abc123  ')).toEqual({
      serverAddress: 'https://nextdo.example.com',
      token: 'abc123',
    });
  });

  it('keeps a base address that already carries a trailing slash', () => {
    // deriveSyncConfig owns the trailing-slash + /api + /sync stripping —
    // this parser must NOT second-guess the address.
    expect(parseConnectionString('https://nextdo.example.com/|abc123')).toEqual({
      serverAddress: 'https://nextdo.example.com/',
      token: 'abc123',
    });
  });

  it('accepts a full 64-hex owner token', () => {
    const hex = 'a'.repeat(64);
    expect(parseConnectionString(`https://nextdo.example.com|${hex}`)).toEqual({
      serverAddress: 'https://nextdo.example.com',
      token: hex,
    });
  });

  it('accepts a LAN address with a port', () => {
    expect(parseConnectionString('http://192.168.1.10:8787|tok')).toEqual({
      serverAddress: 'http://192.168.1.10:8787',
      token: 'tok',
    });
  });

  it('accepts full-width pipe ｜ and ideographic spaces from mobile copy-paste', () => {
    expect(parseConnectionString('　https://nextdo.example.com　｜　tok123　')).toEqual({
      serverAddress: 'https://nextdo.example.com',
      token: 'tok123',
    });
  });
});

describe('deep link nextdo://sync?s=…&t=…', () => {
  it('parses URL-encoded address + token', () => {
    expect(
      parseConnectionString('nextdo://sync?s=https%3A%2F%2Fx.example.com&t=abc123'),
    ).toEqual({ serverAddress: 'https://x.example.com', token: 'abc123' });
  });

  it('parses an UNENCODED address too (some QR generators skip encoding)', () => {
    expect(parseConnectionString('nextdo://sync?s=https://x.example.com&t=abc123')).toEqual({
      serverAddress: 'https://x.example.com',
      token: 'abc123',
    });
  });

  it('parses the three-slash spelling an OS may hand over', () => {
    expect(parseConnectionString('nextdo:///sync?s=https%3A%2F%2Fx.example.com&t=tok')).toEqual(
      { serverAddress: 'https://x.example.com', token: 'tok' },
    );
  });

  it('a token containing reserved characters survives the round-trip', () => {
    expect(
      parseConnectionString('nextdo://sync?s=https%3A%2F%2Fx.example.com&t=a%2Bb%2Fc%3D'),
    ).toEqual({ serverAddress: 'https://x.example.com', token: 'a+b/c=' });
  });

  it('tolerates extra query parameters around s and t', () => {
    expect(
      parseConnectionString('nextdo://sync?v=1&s=https%3A%2F%2Fx.example.com&t=tok&src=qr'),
    ).toEqual({ serverAddress: 'https://x.example.com', token: 'tok' });
  });
});

describe('not a connection string → null (the caller falls back to a bare token)', () => {
  it.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['a bare owner token', 'a'.repeat(64)],
    ['a short bare token', 'abc123'],
    ['a pipe with no token', 'https://nextdo.example.com|'],
    ['a pipe with no address', '|abc123'],
    ['a pipe with only whitespace on both sides', '  |  '],
    ['two pipes (malformed, not silently repaired)', 'https://nextdo.example.com|tok|extra'],
    ['a deep link without t', 'nextdo://sync?s=https%3A%2F%2Fx.example.com'],
    ['a deep link without s', 'nextdo://sync?t=abc123'],
    ['a deep link with both empty', 'nextdo://sync?s=&t='],
    ['a deep link with no query at all', 'nextdo://sync'],
    ['a wrong scheme', 'otherapp://sync?s=https%3A%2F%2Fx.example.com&t=tok'],
    ['a bare address with no token', 'https://nextdo.example.com'],
  ])('%s → null', (_label, input) => {
    expect(parseConnectionString(input)).toBeNull();
  });
});

describe('formatConnectionString', () => {
  it('formats server address and token into plaintext pipe format', () => {
    expect(formatConnectionString('https://example.com', 'tok123')).toBe(
      'https://example.com|tok123',
    );
  });

  it('trims leading/trailing whitespace', () => {
    expect(formatConnectionString('  https://example.com  ', '  tok123  ')).toBe(
      'https://example.com|tok123',
    );
  });

  it('returns empty string if either address or token is blank', () => {
    expect(formatConnectionString('', 'tok123')).toBe('');
    expect(formatConnectionString('https://example.com', '')).toBe('');
    expect(formatConnectionString('   ', 'tok123')).toBe('');
  });

  it('round-trips through parseConnectionString', () => {
    const formatted = formatConnectionString('https://example.com', 'tok123');
    expect(parseConnectionString(formatted)).toEqual({
      serverAddress: 'https://example.com',
      token: 'tok123',
    });
  });
});

describe('formatDeepLink', () => {
  it('formats server address and token into nextdo:// deep link', () => {
    expect(formatDeepLink('https://example.com', 'tok123')).toBe(
      'nextdo://sync?s=https%3A%2F%2Fexample.com&t=tok123',
    );
  });

  it('returns empty string if either address or token is blank', () => {
    expect(formatDeepLink('', 'tok123')).toBe('');
    expect(formatDeepLink('https://example.com', '')).toBe('');
  });

  it('round-trips through parseConnectionString', () => {
    const link = formatDeepLink('https://example.com', 'tok+special/key=');
    expect(parseConnectionString(link)).toEqual({
      serverAddress: 'https://example.com',
      token: 'tok+special/key=',
    });
  });
});