import { env } from '@/lib/env';

const SCRAPER_API_URL = env.SCRAPER_API_URL;
const SCRAPER_API_KEY = env.SCRAPER_API_KEY;
const APP_URL = env.appUrl;

export interface StartCrawlOptions {
  siteId: string;
  domain: string;
  maxPages?: number;
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
  maxPages = 1000,
}: StartCrawlOptions): Promise<StartCrawlResponse> {
  if (!SCRAPER_API_URL || !SCRAPER_API_KEY) {
    throw new Error(
      'Scraper service not configured. Set SCRAPER_API_URL and SCRAPER_API_KEY in .env.local.'
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
      webhookUrl: `${APP_URL}/api/scraper/webhook`,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Scraper service unreachable (${response.status}): ${body || response.statusText}`
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
      'Scraper service not configured. Set SCRAPER_API_URL and SCRAPER_API_KEY in .env.local.'
    );
  }

  const response = await fetch(`${SCRAPER_API_URL}/crawl/${siteId}/stop`, {
    method: 'POST',
    headers: { 'X-API-Key': SCRAPER_API_KEY },
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Scraper service unreachable (${response.status}): ${body || response.statusText}`
    );
  }

  return response.json() as Promise<StopCrawlResponse>;
}
