// Project-wide ESLint (Phase 13B). Correctness and architecture rules only —
// formatting belongs to Prettier (eslint-config-prettier disables overlaps).
import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.js',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      // Unhandled promises are the classic source of silent state bugs.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      // `any` requires a documented escape hatch (eslint-disable + reason).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      // Fastify plugins and finalizer callbacks are async-signature APIs
      // whether or not a given body awaits; the rule fights the framework.
      '@typescript-eslint/require-await': 'off',
      // Zod-heavy code passes schema-validated values around; these
      // type-aware rules produce noise without catching real defects here.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    // Architectural boundary: route handlers validate, authorize, delegate,
    // and serialize — they never touch the database or business rules.
    files: ['apps/api/src/routes/*.ts'],
    ignores: ['apps/api/src/routes/*.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              message: 'Routes must not access the database — put the logic in a domain service.',
              allowTypeImports: true,
            },
          ],
          patterns: [
            {
              group: ['**/lib/money*', '**/lib/rng*', '**/lib/combat-rng*'],
              message: 'Gameplay math belongs in domain services, not route handlers.',
            },
          ],
        },
      ],
    },
  },
  {
    // React: hooks correctness and baseline accessibility.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  {
    // Tests exercise edge cases and inject raw payloads on purpose.
    files: ['**/*.test.ts', 'apps/api/src/test-helpers.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Tests parse untyped injected JSON responses on purpose.
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
);
