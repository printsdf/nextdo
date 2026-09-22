/**
 * ESM resolve hook for the E2E runner (registered via `module.register`
 * from e2e/sync-roundtrip.ts before any product source is imported).
 *
 * WHY: the repo's TS sources (packages/core, packages/db) use EXTENSIONLESS
 * relative imports (e.g. `./lib/ids`) — resolved by the repo's jest/babel
 * and Metro toolchains, but NOT by plain Node ESM, which requires explicit
 * specifiers. Rather than touch product code, this hook rewrites ONLY
 * relative specifiers that plain resolution rejects, trying `.ts`, `.tsx`,
 * and `/index.ts` in order.
 *
 * Everything else is untouched: bare specifiers (node_modules packages,
 * which ship compiled JS with proper extensions), absolute paths, and
 * specifiers that already resolve.
 */
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';

const TS_SUFFIXES = ['', '.ts', '.tsx', '/index.ts'];

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const code = error?.code;
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    const isUnresolved =
      code === 'ERR_MODULE_NOT_FOUND' ||
      code === 'ERR_UNSUPPORTED_DIR_IMPORT' ||
      code === 'ERR_MODULE_NOT_FOUND_ESM';
    if (!isRelative || !isUnresolved || !context.parentURL) {
      throw error;
    }
    const parentPath = fileURLToPath(context.parentURL);
    const base = isAbsolute(specifier) ? specifier : resolvePath(dirname(parentPath), specifier);
    for (const suffix of TS_SUFFIXES) {
      const candidate = base + suffix;
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return await nextResolve(pathToFileURL(candidate).href, context);
        }
      } catch {
        // unreadable candidate — try the next suffix
      }
    }
    throw error;
  }
}
