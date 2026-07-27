import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Root-owned test setup, for the same reason ESLint is root-owned: the
 * scraper's Docker build runs `pnpm install --prod=false`, so anything in
 * its manifest ends up in the image. Vitest lives here instead.
 *
 * Tests live in `tests/` rather than beside the source so no test file lands
 * in a package's build inputs — the scraper's `tsc` emits `src/**` into
 * `dist/`, its Dockerfile COPYs `src`, and `next build` walks `aigenic_app`.
 */
const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(root, 'aigenic_app'),
      // `server-only` throws by design outside a React Server Component.
      // Stub it so server modules can be imported by a plain unit test.
      'server-only': path.resolve(root, 'tests/stubs/server-only.ts'),
      // Same idea for cache revalidation, which needs a request scope.
      'next/cache': path.resolve(root, 'tests/stubs/next-cache.ts'),
    },
  },
  // Widget source is Preact JSX; no app JSX is imported by these tests.
  // Vitest 4 transforms with oxc, not esbuild — setting `esbuild` here is
  // silently ignored.
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    env: {
      // db/index.ts throws at import without this. postgres-js connects
      // lazily, so no socket is ever opened by these tests.
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      SCRAPER_API_KEY: 'test-scraper-key',
      // 32 bytes, so `lib/crypto/secrets.ts` can encrypt in tests. Fixed and
      // public on purpose — it protects nothing here.
      CREDENTIALS_ENCRYPTION_KEY: 'dGVzdC1vbmx5LWtleS0zMi1ieXRlcy1sb25nISEhISE=',
    },
  },
});
