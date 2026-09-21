/**
 * Jest 29 (CJS transform via babel-jest). TS 6.0.3 is typecheck-only here;
 * babel strips types so the tsconfig module setting does not affect emit.
 *
 * The @powersync/* packages are ESM-only, so — unlike @nextdo/core — they
 * must pass through babel as well (transformIgnorePatterns + the `.js`
 * transform entry below).
 *
 * `import.meta.url` (used by @powersync/web's wa-sqlite worker client to
 * locate its worker script) is a parse-time SyntaxError once babel
 * compiles the package to CJS — even though the code path is never
 * executed in tests (we pass `{ opened }`, so no wa-sqlite worker is ever
 * created). The plugin below replaces it with the CJS-equivalent file URL
 * so the module merely parses.
 *
 * NOTE: the plugin is loaded BY PATH (jest-import-meta-url.cjs), not
 * inlined here — jest serializes the config to worker processes as JSON
 * and would silently drop an inline plugin's visitor functions (parallel
 * transforms then emit raw `import.meta` and cache the broken output).
 */
import { fileURLToPath } from 'node:url';

const importMetaUrlPlugin = fileURLToPath(
  new URL('./jest-import-meta-url.cjs', import.meta.url),
);

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
  transformIgnorePatterns: ['node_modules/(?!\\.|@powersync|@journeyapps|comlink|kysely)'],
};
