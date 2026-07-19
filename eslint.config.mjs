import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['coverage', 'dist', 'node_modules', 'out'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      '*.config.ts',
      'scripts/**/*.{cjs,mjs}',
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'tests/**/*.ts',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['scripts/**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['src/renderer/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: 'Use the typed window.openmd preload API instead.',
            },
            {
              name: 'fs',
              message: 'Node.js APIs are not available in the renderer.',
            },
            {
              name: 'path',
              message: 'Node.js APIs are not available in the renderer.',
            },
          ],
          patterns: [
            {
              group: ['electron/*', 'fs/*', 'path/*'],
              message: 'Use the typed window.openmd preload API instead.',
            },
            {
              group: ['node:*'],
              message: 'Node.js APIs are not available in the renderer.',
            },
          ],
        },
      ],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
)
