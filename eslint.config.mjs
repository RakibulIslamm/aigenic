import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';

/**
 * One flat config for the whole repo — the Next.js app, the widget, and the
 * scraper. It lives at the root (and the toolchain is a root devDependency)
 * so `vps-scraper` gets linted without adding ESLint to its own tree: its
 * Docker build installs devDependencies, and every package there lands in
 * the image.
 *
 * Run it from the repo root: `pnpm lint` / `pnpm lint:fix`.
 */

/** external/builtin → `@/…` → relative. Matches the house style. */
const importOrder = [
  'error',
  {
    groups: [['builtin', 'external'], 'internal', ['parent', 'sibling', 'index']],
    pathGroups: [{ pattern: '@/**', group: 'internal' }],
    pathGroupsExcludedImportTypes: ['builtin'],
    // The codebase doesn't separate import groups with blank lines, and
    // enforcing it would churn every file for no readability gain.
    'newlines-between': 'ignore',
  },
];

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/.next/**',
    '**/dist/**',
    '**/out/**',
    '**/build/**',
    // Built widget bundle — minified output, not source.
    'aigenic_app/public/**',
    '**/next-env.d.ts',
    // Regenerable agent context.
    '.compact-pro/**',
  ]),

  // The Next.js app: React + Next rules, plus the TypeScript preset.
  {
    files: ['aigenic_app/**/*.{js,mjs,ts,tsx}'],
    extends: [...nextVitals, ...nextTs],
    settings: { next: { rootDir: 'aigenic_app' } },
  },

  // Plain TypeScript packages — no React/Next rules apply to the scraper,
  // and the widget's Preact JSX doesn't want the Next preset either.
  {
    files: ['vps-scraper/**/*.ts', 'widget/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended],
    rules: {
      // A leading underscore marks a binding that exists only to satisfy a
      // signature — Express only treats a middleware as an error handler if
      // it declares all four parameters, so `_next` must stay declared.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },

  // Import ordering, everywhere.
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    plugins: { import: importPlugin },
    rules: { 'import/order': importOrder },
  },

  // Must stay last: switches off every rule that would fight Prettier.
  prettier,
]);
