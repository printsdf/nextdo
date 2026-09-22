/**
 * E2E sync round-trip — entry point.
 *
 *   node e2e/sync-roundtrip.ts        # full verification run (default)
 *   node e2e/sync-roundtrip.ts run    # same
 *   node e2e/sync-roundtrip.ts down   # tear down the docker stack only
 *
 * See README.md for what it drives and what it leaves running.
 */
import { register } from 'node:module';

// Register the TS resolve hook BEFORE any product source is imported: the
// repo's TS sources use extensionless relative imports, which plain Node
// ESM does not resolve (see hooks/resolve-ts.mjs).
register('./hooks/resolve-ts.mjs', import.meta.url);

const { main } = await import('./run.ts');
const ok = await main(process.argv.slice(2));
process.exit(ok ? 0 : 1);
