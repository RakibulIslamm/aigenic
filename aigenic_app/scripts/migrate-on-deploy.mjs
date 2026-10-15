/**
 * Applies database migrations as part of a Vercel deployment, before
 * `next build` — so new code never goes live against a schema it doesn't
 * match. If a migration fails, this exits non-zero, the build fails, and the
 * previous deployment keeps serving: a failed migration can't ship.
 *
 * Runs only where it's safe:
 *
 * - **Production** deploys (`VERCEL_ENV=production`): always.
 * - **Preview** deploys: by default too, so a preview never boots against a
 *   schema it doesn't match. Know the trade-off: while previews share the
 *   production database (one DATABASE_URL for both), a branch's migrations
 *   reach production as soon as its preview builds — before review or
 *   merge. Write migrations additively (add, don't drop or rename) while
 *   that's true, or give previews their own database (a Neon branch per
 *   preview via Neon's Vercel integration). `MIGRATE_ON_PREVIEW=0` turns
 *   preview migrations off.
 * - Anywhere else (local `pnpm build`, GitHub Actions CI): never. CI proves
 *   migrations in its own `database` job against a throwaway Postgres.
 */

const env = process.env.VERCEL_ENV;

if (!env) {
  console.log('migrate-on-deploy: not a Vercel build — skipping migrations.');
  process.exit(0);
}

if (env === 'preview' && process.env.MIGRATE_ON_PREVIEW === '0') {
  console.log(
    'migrate-on-deploy: preview build — skipping migrations (MIGRATE_ON_PREVIEW=0).',
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
