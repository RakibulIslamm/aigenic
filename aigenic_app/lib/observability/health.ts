/**
 * The body of `GET /api/health` (SRS 7.2), separated from the route so it
 * can be tested without a database. Uptime monitors read the status code;
 * people read the JSON.
 */

export type DatabaseState = 'ok' | 'error' | 'timeout';

export interface HealthReport {
  status: 'ok' | 'degraded';
  database: DatabaseState;
  /** `production`, `preview` or `development`. */
  environment: string;
  /** Short commit SHA of this deploy, or null locally. */
  release: string | null;
  checkedAt: string;
}

export const DATABASE_TIMEOUT_MS = 3_000;

export async function probeDatabase(
  ping: () => Promise<unknown>,
  timeoutMs = DATABASE_TIMEOUT_MS,
): Promise<DatabaseState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    return await Promise.race([ping().then(() => 'ok' as const), timeout]);
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

export function buildHealthReport(
  database: DatabaseState,
  env: { VERCEL_ENV?: string; NODE_ENV?: string; VERCEL_GIT_COMMIT_SHA?: string },
  now: Date = new Date(),
): HealthReport {
  return {
    status: database === 'ok' ? 'ok' : 'degraded',
    database,
    environment: env.VERCEL_ENV ?? env.NODE_ENV ?? 'development',
    release: env.VERCEL_GIT_COMMIT_SHA ? env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null,
    checkedAt: now.toISOString(),
  };
}
