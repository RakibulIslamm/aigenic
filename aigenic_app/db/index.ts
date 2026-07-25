import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import * as schema from './schema';

const connectionString = env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set — the app cannot reach Postgres. Copy .env.local.example to .env.local and fill it in.',
  );
}

// `prepare: false` is kept because Neon's pooled URL (-pooler) runs PgBouncer
// in transaction mode, where prepared statements break across pooled sessions.
// `max: 10` lets Promise.all queries actually run concurrently — with max: 1
// every "parallel" call was secretly serialized on a single connection.
// `connect_timeout: 30` (was 10) because Neon scale-to-zero has to resume the
// compute before it can accept a connection, and a cold resume regularly
// exceeds 10s — which surfaced as a raw CONNECT_TIMEOUT crash page.
const client = postgres(connectionString, {
  prepare: false,
  max: 10,
  idle_timeout: 20,
  connect_timeout: 30,
});

export const db = drizzle(client, { schema });
export { schema };

/**
 * postgres.js / libpq error codes that mean "the connection never came up",
 * as opposed to "the query was rejected". Only these are worth a retry — a
 * constraint violation or a syntax error will fail identically the second time.
 */
const CONNECTION_ERROR_CODES = new Set([
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_DESTROYED',
  'CONNECTION_ENDED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);

function isConnectionError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && CONNECTION_ERROR_CODES.has(code);
}

/**
 * Runs a query, retrying **once** when the failure was the connection rather
 * than the statement. This is the Neon scale-to-zero case: the first request
 * after an idle period triggers a compute resume, that connection attempt can
 * time out, and every connection after it succeeds. One retry turns a crash
 * page into a slow page.
 *
 * Wrap the *first* query of a request path (the dashboard's site list, the
 * per-site lookup, user provisioning) — once one query has landed the pool is
 * warm and the rest don't need it.
 */
export async function withDbRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    log.warn('[db] connection failed, retrying once (Neon cold start?)', {
      code: (err as { code?: string }).code,
    });
    return run();
  }
}
