/**
 * Jest 29 (CJS transform via babel-jest). TS 6.0.3 is typecheck-only here;
 * babel strips types so the tsconfig module setting does not affect emit.
 *
 * The @powersync/* packages are ESM-only, so — unlike @nextdo/core — they
 * must pass through babel as well (transformIgnorePatterns + the `.js`
 * transform entry below).
 */

/**
 * `import.meta.url` (used by @powersync/web's wa-sqlite worker client to
 * locate its worker script) is a parse-time SyntaxError once babel compiles
 * the package to CJS — even though the code path is never executed in tests
 * (we pass `{ opened }`, so no wa-sqlite worker is ever created). Replace
 * it with the CJS-equivalent file URL so the module merely parses.
 */
const importMetaUrlPlugin = {
  name: 'nextdo-import-meta-url',
  visitor: {
    MetaProperty(path) {
      if (path.node.meta.name !== 'import') {
        return;
      }
      // Covers both bare `import.meta` and `import.meta.url` (the `.url`
      // property access sits on the surrounding MemberExpression).
      path.replaceWithSourceString(
        '({ url: require("url").pathToFileURL(__filename).href })',
      );
    },
  },
};

export default {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/src/test-setup.ts'],
  testMatch: ['<rootDir>/src/**/*.test.ts'],
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
        plugins: [importMetaUrlPlugin],
      },
    ],
  },
  // pnpm caveat: files live under node_modules/.pnpm/<pkg>/node_modules/<pkg>,
  // so the pattern must also look past the `.pnpm` hop, otherwise the FIRST
  // `node_modules/` occurrence (followed by `.pnpm`) makes everything ignored.
  // @powersync/*, @journeyapps/wa-sqlite, comlink and kysely ship ESM entry
  // points that must be compiled to CJS for jest.
  // NOTE: jest's transform cache key drops functions, so after changing the
  // inline plugin above, run `jest --clearCache` once.
  transformIgnorePatterns: ['node_modules/(?!\\.|@powersync|@journeyapps|comlink|kysely)'],
};
