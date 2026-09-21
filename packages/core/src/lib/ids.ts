/**
 * ULID generation — sortable (lexicographic order = time order).
 *
 * Implemented locally (Crockford base32) to keep @nextdo/core at zero
 * runtime dependencies. Layout: 48-bit millisecond timestamp (10 chars)
 * + 8 random bytes (16 chars) = 26 chars.
 */

/** Crockford base32 alphabet — excludes I, L, O, U. */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const MAX_TIMESTAMP = 0xffff_ffff_ffff; // 48 bits

/**
 * Mint a ULID for `now`. `rng` is injectable for tests; it must return
 * values in [0, 1).
 */
export function ulid(now: Date, rng: () => number = Math.random): string {
  const timestamp = Math.min(Math.max(Math.trunc(now.getTime()), 0), MAX_TIMESTAMP);
  let out = '';
  for (let i = 9; i >= 0; i--) {
    out += ENCODING.charAt(((timestamp >> (i * 5)) & 0x1f) >>> 0);
  }
  for (let i = 0; i < 8; i++) {
    const byte = Math.trunc(rng() * 256) & 0xff;
    out += ENCODING.charAt((byte >> 3) & 0x1f);
    out += ENCODING.charAt(byte & 0x1f);
  }
  return out;
}

/** HabitDay id — the one non-ULID id (deterministic for multi-device idempotency). */
export function habitDayId(habitId: string, localDate: string): string {
  return `hd-${habitId}-${localDate}`;
}
