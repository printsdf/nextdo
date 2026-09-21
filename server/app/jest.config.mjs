/**
 * Jest 29 (CJS transform via babel-jest). TS 6.0.3 is typecheck-only here;
 * babel strips types so the tsconfig module setting does not affect emit.
 *
 * No import.meta handling is needed in this package: the only file that
 * uses import.meta is src/index.ts (the entry-point check), and jest never
 * loads it — the tests import the side-effect-free app from src/app.ts.
 *
 * `jose` IS ESM-only (its package is "type": "module" with a single ESM
 * entry), so it must pass through babel like @nextdo's db does for
 * @powersync/*: the transformIgnorePatterns must also look past pnpm's
 * `.pnpm` hop, otherwise the FIRST `node_modules/` occurrence (followed
 * by `.pnpm`) makes everything ignored. hono / @hono/node-server / pg
 * ship CJS entries and resolve as-is.
 */
export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  // Node16 ESM sources use `.js` specifiers for relative imports (tsc
  // requirement); jest resolves them back to the .ts sources.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '\\.[jt]s$': [
      'babel-jest',
      {
        babelrc: false,
        configFile: false,
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
  // pnpm caveat (same as packages/db): files live under
  // node_modules/.pnpm/<pkg>/node_modules/<pkg>, so the pattern must look
  // past the `.pnpm` hop — the `(?!\.)` keeps the first occurrence
  // (followed by `.pnpm`) from ignoring everything, and `jose` (ESM-only)
  // is compiled to CJS for jest.
  transformIgnorePatterns: ['node_modules/(?!\\.|jose)'],
};
