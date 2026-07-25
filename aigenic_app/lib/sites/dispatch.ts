import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { articles, sites } from '@/db/schema';
import { startSiteCrawl } from '@/lib/scraper/client';

export type DispatchSkipReason = 'site-deleted' | 'already-crawling';

export type DispatchResult =
  { dispatched: true } | { dispatched: false; reason: DispatchSkipReason };

/**
 * Single source of truth for the "kick off a crawl for this site" sequence:
 * skip if the site is gone or already crawling, wipe its articles, flip
 * `kbStatus` to `crawling`, and POST the job to the VPS scraper. On scraper
 * failure, flips `kbStatus` to `failed` and re-throws so retry policy (or
 * the caller) can react.
 *
 * Used by:
 * - [crawlSiteTask] — runs in the Trigger.dev cloud, gets retries
 * - rescrapeSiteAction fallback — when Trigger.dev isn't configured locally
 * - createSiteAction — initial crawl on site creation
 */
export async function dispatchSiteCrawl(params: {
  siteId: string;
  domain: string;
  maxPages?: number;
}): Promise<DispatchResult> {
  const { siteId, domain, maxPages } = params;

  const existing = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { id: true, kbStatus: true },
  });
  if (!existing) {
    return { dispatched: false, reason: 'site-deleted' };
  }
  if (existing.kbStatus === 'crawling') {
    return { dispatched: false, reason: 'already-crawling' };
  }

  await db.delete(articles).where(eq(articles.siteId, siteId));
  await db.update(sites).set({ kbStatus: 'crawling' }).where(eq(sites.id, siteId));

  try {
    await startSiteCrawl({ siteId, domain, maxPages });
  } catch (err) {
    await db.update(sites).set({ kbStatus: 'failed' }).where(eq(sites.id, siteId));
    throw err instanceof Error ? err : new Error(String(err));
  }

  return { dispatched: true };
}
