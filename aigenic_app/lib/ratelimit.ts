import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { log } from '@/lib/log';

/**
 * Shared fixed-window rate limiter over Postgres (`rate_limits` table).
 *
 * The app runs as stateless serverless functions, so an in-process counter
 * would reset on every cold start and never be shared between instances —
 * the store has to live outside the process. We already hold a Postgres
 * connection on every request; a single-row upsert per check is cheap, needs
 * no new infrastructure, and is honest across all instances. If burst
 * precision ever matters enough to pay for Upstash, this module is the only
 * file that has to change (`consumeRateLimit` keeps its signature).
 *
 * Fixed window, not sliding: a key's row carries `(window_start, count)`;
 * once the window has elapsed the same upsert resets it in place. Worst case
 * a client gets ~2× the limit across one window boundary — acceptable for an
 * abuse gate, and the row count stays at one per key.
 *
 * Consumers (chat gates today; escalation caps and SSE concurrency caps in
 * later phases) namespace their own keys, e.g. `chat:ip:10s:<ip>`. The window
 * length MUST be encoded in the key — the same identity limited over two
 * windows is two counters.
 */

export interface RateLimitResult {
  ok: boolean;
  /** Requests left in the current window; 0 when blocked. */
  remaining: number;
  /** Seconds until the window resets — the `Retry-After` value on a 429. */
  retryAfterSeconds: number;
}

/** Longest window any caller may use; the stale-row sweep assumes it. */
export const MAX_WINDOW_SECONDS = 24 * 60 * 60;

/** ~1 sweep per 256 checks keeps abandoned keys from accumulating forever. */
const CLEANUP_PROBABILITY = 1 / 256;

/**
 * Counts this request against `key`'s window and says whether it fit.
 *
 * Over-limit requests still increment the counter (they cost the attacker a
 * row update either way) but never extend the window — `Retry-After` is
 * always the time to the window's natural end.
 *
 * **Fails open.** If the store is unreachable the request is allowed and the
 * failure is logged: an attacker cannot break the table from the outside
 * (that takes DB access, at which point rate limits are moot), whereas
 * failing closed would take every tenant's widget down with the limiter.
 */
export async function consumeRateLimit({
  key,
  limit,
  windowSeconds,
}: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  if (windowSeconds > MAX_WINDOW_SECONDS) {
    throw new Error(`rate-limit window exceeds MAX_WINDOW_SECONDS: ${windowSeconds}`);
  }

  try {
    const rows = (await db.execute(sql`
      insert into rate_limits ("key", window_start, count)
      values (${key}, now(), 1)
      on conflict ("key") do update set
        count = case
          when rate_limits.window_start <= now() - make_interval(secs => ${windowSeconds})
            then 1
          else rate_limits.count + 1
        end,
        window_start = case
          when rate_limits.window_start <= now() - make_interval(secs => ${windowSeconds})
            then now()
          else rate_limits.window_start
        end
      returning
        count,
        greatest(
          1,
          ceil(extract(epoch from
            window_start + make_interval(secs => ${windowSeconds}) - now()
          ))
        )::int as retry_after
    `)) as unknown as Array<{ count: number; retry_after: number }>;

    const row = rows[0];
    if (!row) throw new Error('rate-limit upsert returned no row');

    maybeSweepStaleRows();

    return {
      ok: row.count <= limit,
      remaining: Math.max(0, limit - row.count),
      retryAfterSeconds: row.retry_after,
    };
  } catch (err) {
    log.error('rate limiter unavailable — failing open', { key, err });
    return { ok: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

/**
 * Fire-and-forget deletion of rows whose window ended over a day ago (safe
 * for any legal window, per `MAX_WINDOW_SECONDS`). Runs on a small fraction
 * of checks so no request ever waits on it.
 */
function maybeSweepStaleRows(): void {
  if (Math.random() >= CLEANUP_PROBABILITY) return;
  void db
    .execute(sql`delete from rate_limits where window_start < now() - interval '2 days'`)
    .catch((err: unknown) => {
      log.warn('rate-limit stale-row sweep failed', { err });
    });
}

/**
 * Client IP for rate-limit keying. On Vercel `x-forwarded-for` is set by the
 * platform (client first), so it is trustworthy there. Locally, with no proxy
 * in front, neither header exists and every caller shares the `unknown`
 * bucket — fine for dev, where all traffic is one machine anyway.
 */
export function clientIp(request: { headers: Headers }): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}
