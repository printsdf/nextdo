/**
 * ULID generation — 26-char Crockford base32 (48-bit millisecond timestamp
 * + 80-bit random). @nextdo/server is ISOLATED (Rule 1: no monorepo
 * imports), so this is a standalone copy of the format used by
 * packages/core's `ulid()` — the ids feed the same `id TEXT` primary keys.
 */
import { randomBytes } from 'node:crypto';

/** Crockford base32 alphabet (no I, L, O, U). */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Generate a ULID for the given instant (defaults to now). */
export function ulid(now: Date = new Date()): string {
  const time = Math.floor(now.getTime());
  let out = '';
  // 48-bit timestamp → 10 chars (most significant first; the first char
  // uses the top 3 bits only, as in the ULID spec).
  for (let shift = 47; shift >= 0; shift -= 5) {
    out += CROCKFORD[(time >> shift) & 31];
  }
  // 80-bit random → 16 chars.
  const rand = randomBytes(10);
  for (let i = 0; i < 16; i++) {
    const byteIndex = Math.floor((i * 5) / 8);
    const bitOffset = i * 5 - byteIndex * 8;
    let value = (rand[byteIndex] ?? 0) >> bitOffset;
    if (bitOffset > 3) {
      value |= (rand[byteIndex + 1] ?? 0) << (8 - bitOffset);
    }
    out += CROCKFORD[value & 31];
  }
  return out;
}
