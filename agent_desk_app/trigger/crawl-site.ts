import { logger, task } from '@trigger.dev/sdk/v3';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { articles, sites } from '@/db/schema';
import { startSiteCrawl, isScraperConfigured } from '@/lib/scraper/client';
import type { CrawlKind } from '@/lib/sites/crawl-runs';

export interface CrawlSitePayload {
  siteId: string;
  userId: string;
  domain: string;
  /**
   * Origin of the request. Used for logging and dashboard filtering only —
   * the actual `crawl_runs` row is inserted by the caller (the server action
   * for manual, the cron task for scheduled), so the quota slot is claimed
   * synchronously and is not in a race with the queued task.
   */
  kind: CrawlKind;
}

/**
 * Child task: dispatches a single crawl to the VPS scraper. Wrapped in a
 * Trigger.dev queue capped at 3 concurrent runs to match the scraper's
 * `SCRAPER_CONCURRENCY=3` — fanning out 100 site runs from the daily cron
 * still only puts 3 crawls in flight against the VPS at any moment; the rest
 * wait in Trigger.dev's queue, not in scraper memory.
 *
 * Retries are per-site, so a transient scraper failure on one site doesn't
 * abort the whole daily batch.
 */
export const crawlSiteTask = task({
  id: 'crawl-site',
  queue: { name: 'scraper-dispatch', concurrencyLimit: 3 },
  maxDuration: 1800,
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
    factor: 2,
    randomize: true,
  },
  run: async (payload: CrawlSitePayload) => {
    const { siteId, userId, domain, kind } = payload;

    if (!isScraperConfigured()) {
      logger.warn('Scraper not configured — skipping', { siteId });
      return { siteId, dispatched: false, reason: 'scraper-not-configured' as const };
    }

    // Skip if a crawl is already running for this site — covers the case
    // where a previous run is still in-flight when the cron fires again.
    const existing = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
      columns: { id: true, kbStatus: true },
    });
    if (!existing) {
      return { siteId, dispatched: false, reason: 'site-deleted' as const };
    }
    if (existing.kbStatus === 'crawling') {
      logger.log('Skipping — already crawling', { siteId });
      return { siteId, dispatched: false, reason: 'already-crawling' as const };
    }

    await db.delete(articles).where(eq(articles.siteId, siteId));
    await db
      .update(sites)
      .set({ kbStatus: 'crawling' })
      .where(eq(sites.id, siteId));

    try {
      await startSiteCrawl({ siteId, domain });
    } catch (err) {
      await db
        .update(sites)
        .set({ kbStatus: 'failed' })
        .where(eq(sites.id, siteId));
      // Re-throw so Trigger.dev applies the retry policy.
      throw err instanceof Error ? err : new Error(String(err));
    }

    return { siteId, userId, dispatched: true, kind };
  },
});
