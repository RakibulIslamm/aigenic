import path from 'node:path';
import { config } from 'dotenv';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

/**
 * Applies pending migrations from ./drizzle. Replaces `drizzle-kit migrate`,
 * for two reasons:
 *
 * 1. **Quiet, honest output.** Every run bootstraps the bookkeeping with
 *    `CREATE SCHEMA IF NOT EXISTS drizzle` / `CREATE TABLE IF NOT EXISTS
 *    drizzle.__drizzle_migrations`; from the second run onwards Postgres
 *    answers both with a NOTICE, and postgres-js dumps each one as a raw
 *    object — twenty lines of alarming noise around a healthy result.
 *    drizzle-kit builds its own client and offers no `onnotice` hook, and the
 *    server-side alternatives don't hold everywhere (Neon's pooler drops
 *    unknown startup parameters like `client_min_messages`). Owning the
 *    connection lets us filter the two known-benign notices client-side,
 *    which works against any endpoint. Anything else still prints.
 *
 * 2. **Says where it's pointing.** DATABASE_URL has flipped between local
 *    Postgres and Neon in this repo's history; a migration runner should name
 *    its target before touching it.
 *
 * Same journal, same `drizzle.__drizzle_migrations` table — drizzle-kit and
 * this script are interchangeable and can be mixed freely.
 * (`pnpm db:generate` still uses drizzle-kit; only the applying moved here.)
 */

const appDir = path.join(import.meta.dirname, '..');
config({ path: path.join(appDir, '.env.local') });
config({ path: path.join(appDir, '.env'), override: false });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set — nothing to migrate against.');
  process.exit(1);
}

const target = new URL(url);
console.log(`Applying migrations to ${target.host}${target.pathname}`);

/** The two notices every post-first run provokes; anything else is real. */
const BOOTSTRAP_NOTICE_CODES = new Set([
  '42P06', // schema "drizzle" already exists, skipping
  '42P07', // relation "__drizzle_migrations" already exists, skipping
]);

const sql = postgres(url, {
  max: 1,
  onnotice: (notice) => {
    if (BOOTSTRAP_NOTICE_CODES.has(notice.code)) return;
    console.warn(`NOTICE: ${notice.message}`);
  },
});

try {
  await migrate(drizzle(sql), {
    migrationsFolder: path.join(appDir, 'drizzle'),
  });
  const [row] =
    await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
  console.log(`✓ up to date — ${row.count} migrations applied`);
} finally {
  await sql.end();
}
