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

  // Claim the generation this crawl writes into. Incrementing in SQL rather
  // than read-add-write means two dispatches racing here get two different
  // generations instead of both streaming articles into one.
  const [claimed] = await db
    .update(sites)
    .set({ kbStatus: 'crawling', crawlGeneration: sql`${sites.crawlGeneration} + 1` })
    .where(eq(sites.id, siteId))
    .returning({
      generation: sites.crawlGeneration,
      activeGeneration: sites.activeGeneration,
    });

  if (!claimed) {
    // Deleted between the read above and this update.
    return { dispatched: false, reason: 'site-deleted' };
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
    await startSiteCrawl({ siteId, domain, maxPages, generation: claimed.generation });
  } catch (err) {
    await db.update(sites).set({ kbStatus: 'failed' }).where(eq(sites.id, siteId));
    throw err instanceof Error ? err : new Error(String(err));
  }

  return { dispatched: true };
}
