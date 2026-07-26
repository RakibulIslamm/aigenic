import 'server-only';
import { count, eq } from 'drizzle-orm';
import { db } from '@/db';
import { articles, sites } from '@/db/schema';
import { articlesInGeneration, generationForProgress } from '@/lib/sites/generations';

export interface CrawlSnapshot {
  status: string;
  articleCount: number;
  lastSyncedAt: number | null;
  /** Why the last crawl failed — only meaningful while status is 'failed'. */
  lastError: string | null;
  /** 'blocked' | 'unreachable' | 'empty' | null — drives tailored failure UI. */
  lastErrorCode: string | null;
}

export type CrawlEventKind =
  'queued' | 'crawling' | 'articles' | 'complete' | 'failed' | 'stopped';

export interface CrawlEvent {
  kind: CrawlEventKind;
  message: string;
  at: number;
  delta?: number;
  status?: string;
  articleCount?: number;
}

/**
 * Single-query snapshot of everything the SSE stream needs to compute deltas:
 * the site's status, total article count, and last sync timestamp.
 */
export async function fetchCrawlSnapshot(
  siteId: string,
  userId: string,
): Promise<CrawlSnapshot | null> {
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: {
      id: true,
      userId: true,
      kbStatus: true,
      kbLastSyncedAt: true,
      kbLastError: true,
      kbLastErrorCode: true,
      activeGeneration: true,
      crawlGeneration: true,
    },
  });
  if (!site || site.userId !== userId) return null;

  // This feed reports *crawl progress*, so while one is running it counts the
  // staging generation — the rows landing right now, which no other read path
  // is allowed to see. Once the crawl ends, the served generation is the honest
  // answer: a promoted crawl has both counters equal anyway, and a failed one
  // should report the KB that survived, not the staging rows just discarded.
  const [agg] = await db
    .select({ value: count() })
    .from(articles)
    .where(articlesInGeneration(siteId, generationForProgress(site)));

  return {
    status: site.kbStatus,
    articleCount: agg?.value ?? 0,
    lastSyncedAt: site.kbLastSyncedAt ? site.kbLastSyncedAt.getTime() : null,
    lastError: site.kbLastError,
    lastErrorCode: site.kbLastErrorCode,
  };
}

/**
 * Diff two snapshots and synthesize the events the UI should display.
 * Returns an empty array when nothing of interest changed.
 */
export function diffSnapshots(prev: CrawlSnapshot, next: CrawlSnapshot): CrawlEvent[] {
  const events: CrawlEvent[] = [];
  const now = Date.now();

  if (prev.status !== next.status) {
    const kind = statusToEventKind(next.status);
    if (kind) {
      events.push({
        kind,
        message: statusMessage(next.status, next.articleCount),
        at: now,
        status: next.status,
        articleCount: next.articleCount,
      });
    }
  }

  const delta = next.articleCount - prev.articleCount;
  if (delta > 0 && next.status === 'crawling') {
    events.push({
      kind: 'articles',
      message: `${delta} page${delta === 1 ? '' : 's'} indexed`,
      at: now,
      delta,
      articleCount: next.articleCount,
    });
  }

  return events;
}

function statusToEventKind(status: string): CrawlEventKind | null {
  switch (status) {
    case 'pending':
      return 'queued';
    case 'crawling':
      return 'crawling';
    case 'ready':
      return 'complete';
    case 'failed':
      return 'failed';
    case 'stopped':
      return 'stopped';
    default:
      return null;
  }
}

function statusMessage(status: string, articleCount: number): string {
  switch (status) {
    case 'pending':
      return 'Queued';
    case 'crawling':
      return 'Crawler started';
    case 'ready':
      return `Crawl complete · ${articleCount} page${articleCount === 1 ? '' : 's'} indexed`;
    case 'failed':
      return 'Crawl failed';
    case 'stopped':
      return 'Crawl stopped';
    default:
      return status;
  }
}
