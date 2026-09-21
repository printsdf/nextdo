import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/.swc/**',
      '**/src-tauri/**',
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
    // logger.ts is the sanctioned console wrapper
    files: ['packages/core/src/lib/logger.ts'],
    rules: { 'no-console': 'off' },
  },
);
