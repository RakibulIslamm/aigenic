/**
 * Applies database migrations as part of a Vercel deployment, before
 * `next build` — so new code never goes live against a schema it doesn't
 * match. If a migration fails, this exits non-zero, the build fails, and the
 * previous deployment keeps serving: a failed migration can't ship.
 *
 * Runs only where it's safe:
 *
 * - **Production** deploys (`VERCEL_ENV=production`): always.
 * - **Preview** deploys: only with `MIGRATE_ON_PREVIEW=1`. Previews build
 *   unmerged branches, and when a preview shares the production database
 *   (one DATABASE_URL for both), migrating there changes production for code
 *   that may never be merged. Opt in when previews have their own database —
 *   e.g. a Neon branch per preview via Neon's Vercel integration — or when
 *   you've checked the pending migrations are safe for production.
 * - Anywhere else (local `pnpm build`, GitHub Actions CI): never. CI proves
 *   migrations in its own `database` job against a throwaway Postgres.
 */

const env = process.env.VERCEL_ENV;

if (!env) {
  console.log('migrate-on-deploy: not a Vercel build — skipping migrations.');
  process.exit(0);
}

if (env === 'preview' && process.env.MIGRATE_ON_PREVIEW !== '1') {
  console.log(
    'migrate-on-deploy: preview build — skipping migrations (set MIGRATE_ON_PREVIEW=1 to run them here).',
  );
  process.exit(0);
}

if (env !== 'production' && env !== 'preview') {
  console.log(`migrate-on-deploy: VERCEL_ENV=${env} — skipping migrations.`);
  process.exit(0);
}

console.log(`migrate-on-deploy: ${env} build — applying migrations.`);
// The migrator runs at import; any failure rejects here and fails the build.
await import('./migrate.mjs');
