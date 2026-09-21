/**
 * Jest 29 (CJS transform via babel-jest). TS 6.0.3 is typecheck-only here;
 * babel strips types so the tsconfig module setting does not affect emit.
 */
export default {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/src/test-setup.ts'],
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
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
};
