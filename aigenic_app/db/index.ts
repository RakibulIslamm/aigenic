import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/lib/env';
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
const client = postgres(connectionString, {
  prepare: false,
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
export { schema };
