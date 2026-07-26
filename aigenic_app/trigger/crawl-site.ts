import { logger, task } from '@trigger.dev/sdk/v3';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { sites } from '@/db/schema';
import { isScraperConfigured } from '@/lib/env';
import { dispatchSiteCrawl } from '@/lib/sites/dispatch';
import { deleteCrawlRun, type CrawlKind } from '@/lib/sites/crawl-runs';

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
  /**
   * The quota claim the caller recorded for this crawl, if any. Released
   * here when the task skips without dispatching — the user shouldn't lose
   * a slot to a crawl that never ran.
   */
  crawlRunId?: string;
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
    const { siteId, userId, domain, kind, maxPages, crawlRunId } = payload;

    logger.log('Starting crawl', { siteId, userId, domain, kind, maxPages });

    if (!isScraperConfigured()) {
      // Throw instead of returning success-shaped data so the run shows up
      // as Failed in cloud.trigger.dev — otherwise the user sees "task
      // completed" and assumes the crawl ran, when in fact nothing happened.
      // Most likely cause: SCRAPER_API_URL / SCRAPER_API_KEY are missing
      // from the Trigger.dev project's environment variables.
      throw new Error(
        'Scraper not configured in this Trigger.dev environment. ' +
          'Set SCRAPER_API_URL and SCRAPER_API_KEY in the Trigger.dev project env.',
      );
    }

    const result = await dispatchSiteCrawl({ siteId, domain, maxPages });
    if (!result.dispatched) {
      // `site-deleted` and `already-crawling` are legitimate no-ops — log them
      // visibly but don't fail the run (retrying won't help). The quota slot
      // the caller claimed for this crawl is refunded: no crawl, no charge.
      logger.warn('Crawl skipped', { siteId, reason: result.reason });
      if (crawlRunId) {
        await deleteCrawlRun(crawlRunId);
      }
      return { siteId, dispatched: false, reason: result.reason };
    }

    logger.log('Crawl dispatched to scraper', { siteId });
    return { siteId, userId, dispatched: true, kind };
  },
  onFailure: async ({ payload, error }) => {
    // Final-retry failure (scraper env missing, DB down, VPS refused every
    // attempt). If the dispatch never claimed the crawl, the site is still
    // `pending` — flip it to `failed` so it's recoverable via Resync instead
    // of stuck behind the "crawl in progress" guard forever. A site already
    // in `crawling` had a successful dispatch; the watchdog owns that case.
    // Either way the quota slot comes back: no crawl ran.
    const { siteId, crawlRunId } = payload as CrawlSitePayload;
    logger.error('Crawl task failed after final retry', { siteId, error });
    await db
      .update(sites)
      .set({
        kbStatus: 'failed',
        pendingCrawlRunId: null,
        kbLastError:
          'We could not hand the crawl to our crawler service. Retry in a bit; if this keeps happening, contact support.',
        kbLastErrorCode: 'unreachable',
      })
      .where(and(eq(sites.id, siteId), eq(sites.kbStatus, 'pending')));
    if (crawlRunId) {
      await deleteCrawlRun(crawlRunId);
    }
  },
});
