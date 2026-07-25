import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { sites } from '@/db/schema';
import { crawlSiteTask } from '@/trigger/crawl-site';
import { dispatchSiteCrawl } from '@/lib/sites/dispatch';
import { isScraperConfigured, isTriggerConfigured } from '@/lib/env';
import { ensureTriggerConfigured } from '@/lib/trigger/config';

export interface EnqueueSiteCrawlInput {
  siteId: string;
  userId: string;
  domain: string;
  maxPages?: number;
  /**
   * After a successful queue enqueue, flip `kbStatus` → 'pending' so the
   * dashboard reacts immediately instead of waiting for the worker to pick
   * the job up (which flips it to 'crawling'). Only applies to the
   * Trigger.dev path — the synchronous fallback flips status itself.
   */
  optimisticPending?: boolean;
  /**
   * The `crawl_runs` quota claim paying for this crawl, if any. Passed into
   * the queued task so it can release the slot when it skips instead of
   * dispatching (the user shouldn't pay for a crawl that never ran).
   */
  crawlRunId?: string;
}

export type EnqueueSiteCrawlResult =
  { ok: true; via: 'trigger' | 'sync' } | { ok: false; error: string };

/**
 * The one place that decides how a crawl gets dispatched: prefer the
 * Trigger.dev queue (`scraper-dispatch`, concurrencyLimit: 3) so the VPS
 * never sees more than 3 concurrent crawls regardless of origin; fall back
 * to a synchronous dispatch when Trigger.dev isn't configured (local dev
 * without TRIGGER_API_KEY). Errors come back as values, not throws, so
 * callers decide whether a failure is fatal (rescrape releases its quota
 * slot) or informational (site creation still succeeds).
 */
export async function enqueueSiteCrawl(
  input: EnqueueSiteCrawlInput,
): Promise<EnqueueSiteCrawlResult> {
  const { siteId, userId, domain, maxPages, optimisticPending, crawlRunId } = input;

  if (isTriggerConfigured()) {
    ensureTriggerConfigured();
    try {
      const handle = await crawlSiteTask.trigger({
        siteId,
        userId,
        domain,
        kind: 'manual',
        maxPages,
        crawlRunId,
      });
      if (optimisticPending) {
        // The run id is stored alongside the flip so Stop can cancel the
        // queue entry; dispatch clears it again the moment the task claims
        // the crawl.
        await db
          .update(sites)
          .set({
            kbStatus: 'pending',
            crawlStartedAt: new Date(),
            pendingCrawlRunId: handle.id,
          })
          .where(eq(sites.id, siteId));
      }
      return { ok: true, via: 'trigger' };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Could not enqueue crawl',
      };
    }
  }

  if (isScraperConfigured()) {
    try {
      const result = await dispatchSiteCrawl({ siteId, domain, maxPages });
      if (!result.dispatched) {
        // Surface the skip as a failure so the caller's cleanup runs (the
        // rescrape action releases its quota claim on `ok: false`).
        return {
          ok: false,
          error:
            result.reason === 'already-crawling'
              ? 'A crawl is already in progress for this site.'
              : 'Site no longer exists.',
        };
      }
      return { ok: true, via: 'sync' };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Could not reach scraper',
      };
    }
  }

  return {
    ok: false,
    error:
      'Scraper service is not configured. Set SCRAPER_API_URL and SCRAPER_API_KEY to enable automatic crawls.',
  };
}
