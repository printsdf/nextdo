import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/.swc/**',
      '**/src-tauri/**',
      '.omp/**',
      '.trellis/**',
      '.agents/**',
      '.codex/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-console': 'error',
      'no-debugger': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // server/app runs under Node; declare its globals (no unpinned `globals` dep)
    files: ['server/app/**/*.ts'],
    languageOptions: {
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        performance: 'readonly',
      },
    },
  },
  {
    // logger.ts is the sanctioned console wrapper (spec: only logging path)
    files: ['packages/core/src/lib/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  // must be last: turns off rules that conflict with Prettier
  prettier,
);
