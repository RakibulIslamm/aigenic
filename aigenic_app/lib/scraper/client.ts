import { z } from 'zod';
import { env } from '@/lib/env';
import { isValidAccessKey } from '@/lib/sites/crawler-identity';
import { DEFAULT_CRAWL_MAX_PAGES } from '@/lib/sites/limits';

const SCRAPER_API_URL = env.SCRAPER_API_URL;
const SCRAPER_API_KEY = env.SCRAPER_API_KEY;
const APP_URL = env.appUrl;

/**
 * Both calls here are "accept a job" / "flip a flag" round trips, not the
 * crawl itself — they should answer in milliseconds. Without a timeout, a
 * hung socket to the VPS stalls the caller for the platform default (and a
 * Trigger.dev attempt for up to its 1800s `maxDuration`).
 */
const SCRAPER_REQUEST_TIMEOUT_MS = 15_000;

export interface StartCrawlOptions {
  siteId: string;
  domain: string;
  maxPages?: number;
  /**
   * The staging generation this crawl writes into. The scraper echoes it back
   * on every webhook, which is how the receiver tells this crawl's articles
   * apart from a superseded one's. See `lib/sites/generations.ts`.
   */
  generation: number;
  /**
   * The site's `crawlAccessKey`, sent by the scraper as `X-Aigenic-Access-Key`
   * on every same-site request so the owner's firewall rule can let it in.
   */
  accessKey: string;
}

export interface StartCrawlResponse {
  jobId: string;
  siteId: string;
  status: 'queued';
}

/**
 * Kicks off a crawl on the VPS scraper service. The scraper streams articles
 * back via webhook calls to /api/scraper/webhook, so this returns as soon as
 * the job is accepted.
 */
export async function startSiteCrawl({
  siteId,
  domain,
  maxPages = DEFAULT_CRAWL_MAX_PAGES,
  generation,
  accessKey,
}: StartCrawlOptions): Promise<StartCrawlResponse> {
  if (!SCRAPER_API_URL || !SCRAPER_API_KEY) {
    throw new Error(
      'Scraper service not configured. Set SCRAPER_API_URL and SCRAPER_API_KEY in .env.local.',
    );
  }

  const response = await fetch(`${SCRAPER_API_URL}/crawl`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': SCRAPER_API_KEY,
    },
    body: JSON.stringify({
      siteId,
      startUrl: domain,
      maxPages,
      generation,
      // The scraper rejects the whole job over a malformed key. A crawl
      // without one still works for every site that isn't firewalled, so a
      // corrupted value (hand-edited row) degrades instead of failing.
      ...(isValidAccessKey(accessKey) ? { accessKey } : {}),
      webhookUrl: `${APP_URL}/api/scraper/webhook`,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(SCRAPER_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Scraper service unreachable (${response.status}): ${body || response.statusText}`,
    );
  }

  return response.json() as Promise<StartCrawlResponse>;
}

export interface StopCrawlResponse {
  stopped: boolean;
  reason?: string;
}

/**
 * Tells the scraper to abort the in-flight crawl for this site, if any. Safe
 * to call when nothing is running — the scraper returns `{ stopped: false }`
 * and we treat that as a no-op.
 */
export async function stopSiteCrawl(siteId: string): Promise<StopCrawlResponse> {
  if (!SCRAPER_API_URL || !SCRAPER_API_KEY) {
    throw new Error(
      'Scraper service not configured. Set SCRAPER_API_URL and SCRAPER_API_KEY in .env.local.',
    );
  }

  const response = await fetch(`${SCRAPER_API_URL}/crawl/${siteId}/stop`, {
    method: 'POST',
    headers: { 'X-API-Key': SCRAPER_API_KEY },
    cache: 'no-store',
    signal: AbortSignal.timeout(SCRAPER_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Scraper service unreachable (${response.status}): ${body || response.statusText}`,
    );
  }

  return response.json() as Promise<StopCrawlResponse>;
}

/**
 * Mirrors `AccessCheck` in `vps-scraper/src/diagnose.ts`: what one request
 * with the crawl's identity (egress IP, User-Agent, access key) got back.
 * Parsed, not trusted — the scraper deploys separately, and a shape drift
 * must become a clean error rather than a broken Settings card.
 */
// The edge/security service that answered, e.g. "Cloudflare". Optional with a
// null default: a scraper from before the field existed omits it.
const providerField = z.string().max(100).nullable().optional().default(null);

const accessProbeResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), status: z.number().int(), provider: providerField }),
  z.object({
    ok: z.literal(false),
    code: z.enum(['blocked', 'unreachable', 'other']),
    status: z.number().int().nullable(),
    detail: z.string().max(500),
    provider: providerField,
  }),
]);

export type AccessProbeResult = z.infer<typeof accessProbeResultSchema>;

export type ProbeOutcome =
  | { ok: true; result: AccessProbeResult }
  /**
   * `outdated`: the scraper predates `/probe` (404) — deployed out of order.
   * `unreachable`: network failure, timeout, or a non-2xx answer.
   * `invalid-response`: it answered, but not with a probe result.
   */
  | { ok: false; reason: 'outdated' | 'unreachable' | 'invalid-response' };

/**
 * "Can the crawler get in right now?" — one request from the scraper itself,
 * so it tests the owner's firewall rule against our real IP and headers. The
 * probe can take up to the scraper's own 15 s timeout, hence the longer wait.
 *
 * Never throws: every failure is a `reason` the caller can phrase.
 */
export async function probeSiteAccess(
  url: string,
  accessKey: string,
): Promise<ProbeOutcome> {
  if (!SCRAPER_API_URL || !SCRAPER_API_KEY) {
    return { ok: false, reason: 'unreachable' };
  }

  let response: Response;
  try {
    response = await fetch(`${SCRAPER_API_URL}/probe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': SCRAPER_API_KEY,
      },
      body: JSON.stringify({
        url,
        // A key the scraper's schema would reject fails the whole request;
        // probing without it still tells the owner something useful.
        ...(isValidAccessKey(accessKey) ? { accessKey } : {}),
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(SCRAPER_REQUEST_TIMEOUT_MS + 10_000),
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, reason: 'outdated' };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, reason: 'unreachable' };
  }

  const parsed = accessProbeResultSchema.safeParse(
    await response.json().catch(() => null),
  );
  return parsed.success
    ? { ok: true, result: parsed.data }
    : { ok: false, reason: 'invalid-response' };
}
