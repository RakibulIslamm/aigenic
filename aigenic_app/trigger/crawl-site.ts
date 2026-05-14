import { logger, task } from '@trigger.dev/sdk/v3';
import { isScraperConfigured } from '@/lib/scraper/client';
import { dispatchSiteCrawl } from '@/lib/sites/dispatch';
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
  /** Optional per-site cap. Defaults to the scraper client default (1000). */
  maxPages?: number;
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
    const { siteId, userId, domain, kind, maxPages } = payload;

    if (!isScraperConfigured()) {
      logger.warn('Scraper not configured — skipping', { siteId });
      return { siteId, dispatched: false, reason: 'scraper-not-configured' as const };
    }

    const result = await dispatchSiteCrawl({ siteId, domain, maxPages });
    if (!result.dispatched) {
      logger.log('Skipping crawl', { siteId, reason: result.reason });
      return { siteId, dispatched: false, reason: result.reason };
    }

    return { siteId, userId, dispatched: true, kind };
  },
});
