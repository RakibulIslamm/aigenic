import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import { articles, sites } from '@/db/schema';
import { startSiteCrawl } from '@/lib/scraper/client';

export type DispatchSkipReason = 'site-deleted' | 'already-crawling';

export type DispatchResult =
  { dispatched: true } | { dispatched: false; reason: DispatchSkipReason };

/**
 * Single source of truth for the "kick off a crawl for this site" sequence:
 * skip if the site is gone or already crawling, claim a fresh crawl generation,
 * flip `kbStatus` to `crawling`, and POST the job to the VPS scraper. On
 * scraper failure, flips `kbStatus` to `failed` and re-throws so retry policy
 * (or the caller) can react.
 *
 * **The live knowledge base is never touched here.** The new crawl writes into
 * a staging generation and only replaces the old one once it reports a usable
 * result — see [generations.ts](./generations.ts). This function used to
 * `DELETE articles` *before* the POST, so a scraper that was down when the
 * 03:00 UTC cron fired left every customer's widget answering from an empty KB.
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

  // Atomic claim: status flip, crawl start time and generation bump in ONE
  // conditional UPDATE. Two dispatches racing here can't both win — the
  // `kb_status <> 'crawling'` guard makes the loser's update match zero rows,
  // where the previous read-then-update let both proceed (double crawl,
  // double staging-delete). The generation increments in SQL for the same
  // reason: two winners across time still get distinct generations.
  const [claimed] = await db
    .update(sites)
    .set({
      kbStatus: 'crawling',
      crawlStartedAt: new Date(),
      // The queued task this dispatch came from (if any) is now running —
      // there is nothing left for Stop to cancel on the queue.
      pendingCrawlRunId: null,
      crawlGeneration: sql`${sites.crawlGeneration} + 1`,
    })
    .where(and(eq(sites.id, siteId), ne(sites.kbStatus, 'crawling')))
    .returning({
      generation: sites.crawlGeneration,
      activeGeneration: sites.activeGeneration,
      crawlHost: sites.crawlHost,
    });

  if (!claimed) {
    // Zero rows matched: the site is gone, or another dispatch holds the
    // claim. One read only to name the reason for the caller's logs.
    const existing = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
      columns: { id: true },
    });
    return { dispatched: false, reason: existing ? 'already-crawling' : 'site-deleted' };
  }

  // Clear staging rows an earlier crawl abandoned — one that died without a
  // terminal event, or one whose empty `complete` we refused to promote.
  // Anything that isn't the active generation is unreadable by definition, so
  // this only reclaims space; the live KB is matched by `activeGeneration` and
  // survives untouched.
  await db
    .delete(articles)
    .where(
      and(
        eq(articles.siteId, siteId),
        ne(articles.crawlGeneration, claimed.activeGeneration),
      ),
    );

  try {
    await startSiteCrawl({
      siteId,
      domain,
      maxPages,
      generation: claimed.generation,
      // Only sites whose owner connected a DNS provider get routed through a
      // `crawl.` hostname — the record has to exist for the request to resolve
      // at all, so this is read from the row rather than accepted as a
      // parameter. Everything else crawls its own public hostname.
      crawlHost: claimed.crawlHost ?? undefined,
    });
  } catch (err) {
    await db
      .update(sites)
      .set({
        kbStatus: 'failed',
        kbLastError:
          'Our crawler service could not be reached to start the crawl. Retry in a bit; if this keeps happening, contact support.',
        kbLastErrorCode: 'unreachable',
      })
      .where(eq(sites.id, siteId));
    throw err instanceof Error ? err : new Error(String(err));
  }

  return { dispatched: true };
}
