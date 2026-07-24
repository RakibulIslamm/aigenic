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
}

export type EnqueueSiteCrawlResult =
  | { ok: true; via: 'trigger' | 'sync' }
  | { ok: false; error: string };

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
  input: EnqueueSiteCrawlInput
): Promise<EnqueueSiteCrawlResult> {
  const { siteId, userId, domain, maxPages, optimisticPending } = input;

  if (isTriggerConfigured()) {
    ensureTriggerConfigured();
    try {
      await crawlSiteTask.trigger({
        siteId,
        userId,
        domain,
        kind: 'manual',
        maxPages,
      });
      if (optimisticPending) {
        await db
          .update(sites)
          .set({ kbStatus: 'pending' })
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
      await dispatchSiteCrawl({ siteId, domain, maxPages });
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
