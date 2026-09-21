/**
 * Slug utilities: ASCII transliteration (diacritic stripping),
 * hyphenation, 50-character limit, and uniqueness hints for
 * filesystem-safe names.
 */

export const SLUG_MAX_LENGTH = 50;

export interface SlugifyOptions {
  maxLength?: number;
}

/**
 * Transliterate to lowercase ASCII, hyphenate runs of non
 * [a-z0-9] characters, and truncate to `maxLength` (default 50)
 * without a trailing hyphen. Returns '' when the input has no ASCII
 * characters (callers should fall back, e.g. to 'item').
 */
export function slugify(input: string, options: SlugifyOptions = {}): string {
  const maxLength = options.maxLength ?? SLUG_MAX_LENGTH;
  const ascii = input
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= maxLength) return slug;
  return slug.slice(0, maxLength).replace(/-+$/g, '');
}

/**
 * Uniqueness hint: returns `base`, then `${base}-2`, `${base}-3`, ...
 * until the result is not in `taken`. The caller is responsible for
 * persisting the name atomically (a TOCTOU window remains).
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const takenSet = new Set(taken);
  if (!takenSet.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base}-${i}`;
    if (!takenSet.has(candidate)) return candidate;
  }
}
