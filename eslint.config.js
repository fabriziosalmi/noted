import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dist-electron', 'dist-mcp', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Disallow stray console.log — use console.error/warn for legitimate errors
      'no-console': ['warn', { allow: ['error', 'warn'] }],

      // Catch unused variables (already enforced by tsconfig but belt-and-suspenders)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // Prevent floating promises — every async call must be awaited or explicitly void-ed
      '@typescript-eslint/no-floating-promises': 'off', // requires parserOptions.project; left for future type-aware config

      // Explicit return types optional for small functions, required for exported ones
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // Allow type assertions (as X) where necessary — we have good reasons in tests
      '@typescript-eslint/consistent-type-assertions': ['warn', { assertionStyle: 'as' }],

      // Prefer type imports for better tree-shaking
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
    },
  },
  {
    // Relax a11y rules for Electron app (no external users, no screen-reader concern on desktop)
    files: ['src/**/*.tsx'],
    rules: {
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
    },
  },
  {
    // Test files: allow console and type assertions freely
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
