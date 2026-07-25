import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env.local' });
config({ path: '.env', override: false });

/**
 * Every `drizzle-kit migrate` run bootstraps its bookkeeping with
 * `CREATE SCHEMA IF NOT EXISTS drizzle` and `CREATE TABLE IF NOT EXISTS
 * drizzle.__drizzle_migrations`. From the second run onwards Postgres answers
 * both with a NOTICE ("already exists, skipping"), and postgres-js dumps every
 * notice to the console as a raw object — so the normal, healthy output is
 * twenty lines of alarming-looking noise wrapped around the actual result.
 *
 * Raising the connection's message threshold to `warning` drops NOTICE and
 * keeps everything that matters: warnings, and any error still fails the run.
 *
 * postgres-js forwards unrecognised URL query params as startup parameters
 * (see `parseOptions` in postgres/src/index.js), which is why this is a query
 * param rather than a client option — drizzle-kit only lets us pass a URL.
 * Appended as a string rather than via `new URL()` so a password with special
 * characters can't be re-encoded on the way through.
 */
function quiet(url: string): string {
  if (!url) return url;
  return `${url}${url.includes('?') ? '&' : '?'}client_min_messages=warning`;
}

export default defineConfig({
  schema: './db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: quiet(process.env.DATABASE_URL ?? ''),
  },
  verbose: true,
  strict: true,
});
