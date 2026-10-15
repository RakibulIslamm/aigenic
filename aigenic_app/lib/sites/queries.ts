import { cache } from 'react';
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  max,
  min,
  or,
  sql,
} from 'drizzle-orm';
import { db, withDbRetry } from '@/db';
import { articles, conversations, escalations, sites, type Site } from '@/db/schema';
import { startOfCurrentMonthUTC } from '@/lib/dates';
import { isUuid } from '@/lib/ids';
import { crawledArticles, servedArticles } from '@/lib/sites/generations';
import { KB_PAGE_SIZE, KB_SEARCH_MAX_CHARS } from '@/lib/sites/limits';

// The access key is a credential — the sites grid has no use for it, so it
// isn't selected (or shipped into any props) there.
export interface SiteListItem extends Omit<Site, 'crawlAccessKey'> {
  articleCount: number;
  conversationCount: number;
}

export async function listSitesForUser(userId: string): Promise<SiteListItem[]> {
  // First query of the dashboard index — retried once through a Neon cold start.
  const rows = await withDbRetry(() =>
    db
      .select({
        id: sites.id,
        userId: sites.userId,
        name: sites.name,
        domain: sites.domain,
        escalationEmail: sites.escalationEmail,
        widgetConfig: sites.widgetConfig,
        kbStatus: sites.kbStatus,
        kbLastSyncedAt: sites.kbLastSyncedAt,
        kbLastError: sites.kbLastError,
        kbLastErrorCode: sites.kbLastErrorCode,
        activeGeneration: sites.activeGeneration,
        crawlGeneration: sites.crawlGeneration,
        crawlStartedAt: sites.crawlStartedAt,
        pendingCrawlRunId: sites.pendingCrawlRunId,
        activeCrawlRunId: sites.activeCrawlRunId,
        createdAt: sites.createdAt,
        updatedAt: sites.updatedAt,
        articleCount: sql<number>`count(distinct ${articles.id})::int`,
        conversationCount: sql<number>`count(distinct ${conversations.id})::int`,
      })
      .from(sites)
      // Only what each site serves (its active generation + manual documents)
      // — mid-crawl staging rows must not inflate the count the owner sees.
      .leftJoin(
        articles,
        and(
          eq(articles.siteId, sites.id),
          or(
            eq(articles.crawlGeneration, sites.activeGeneration),
            eq(articles.source, 'manual'),
          ),
        ),
      )
      .leftJoin(conversations, eq(conversations.siteId, sites.id))
      .where(eq(sites.userId, userId))
      .groupBy(sites.id)
      .orderBy(desc(sites.createdAt)),
  );

  return rows;
}

// Memoized per-request: the site layout + each tab page both reach for the
// same row, and we don't want N round trips per navigation. It's also the
// first query on every /dashboard/sites/* request, hence the cold-start retry.
export const getSiteForUser = cache(
  async (siteId: string, userId: string): Promise<Site | undefined> => {
    // `siteId` is a raw route param. Bailing here is what turns
    // /dashboard/sites/not-a-uuid into the styled 404 (every caller already
    // treats `undefined` as notFound) instead of a Postgres cast error.
    if (!isUuid(siteId)) return undefined;
    return withDbRetry(() =>
      db.query.sites.findFirst({
        where: and(eq(sites.id, siteId), eq(sites.userId, userId)),
      }),
    );
  },
);

/**
 * Overview numbers for the KB the site serves — pass its `activeGeneration`.
 * For the progress of a crawl in flight use `countCrawledArticles` instead.
 */
export async function getSiteStats(siteId: string, activeGeneration: number) {
  const monthStart = startOfCurrentMonthUTC();

  const [[articleAgg], [conversationAgg], [escalationAgg]] = await Promise.all([
    db
      .select({ value: count() })
      .from(articles)
      .where(servedArticles(siteId, activeGeneration)),
    db
      .select({ value: count() })
      .from(conversations)
      .where(
        and(eq(conversations.siteId, siteId), gte(conversations.createdAt, monthStart)),
      ),
    db
      .select({ value: count() })
      .from(escalations)
      .innerJoin(conversations, eq(escalations.conversationId, conversations.id))
      .where(
        and(eq(conversations.siteId, siteId), gte(escalations.createdAt, monthStart)),
      ),
  ]);

  const articleCount = articleAgg?.value ?? 0;
  const conversationCount = conversationAgg?.value ?? 0;
  const escalationCount = escalationAgg?.value ?? 0;
  const escalationRate = conversationCount > 0 ? escalationCount / conversationCount : 0;

  return {
    articleCount,
    conversationCount,
    escalationCount,
    escalationRate,
  };
}

/**
 * Pages one crawl generation holds — crawled rows only. Pass
 * `generationForProgress(site)` to report a crawl in flight.
 */
export async function countCrawledArticles(siteId: string, generation: number) {
  const [row] = await db
    .select({ value: count() })
    .from(articles)
    .where(crawledArticles(siteId, generation));
  return row?.value ?? 0;
}

export interface ArticlePage {
  rows: Array<typeof articles.$inferSelect>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Returns a single page of articles + the total count in one round trip via
 * Promise.all. Used by the knowledge tab — full-list queries became a real
 * cost once e-commerce sites started landing 300+ products in here.
 */
export async function listArticlesForSitePaged(
  siteId: string,
  {
    page,
    pageSize,
    q,
    generation,
  }: { page: number; pageSize: number; q?: string; generation: number },
): Promise<ArticlePage> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize) || KB_PAGE_SIZE));
  const offset = (safePage - 1) * safePageSize;
  // Clamp here as well as at the page — this is the last line before the
  // `ILIKE` scan, and it's a public-ish surface (any caller, any `q`).
  const trimmedQ = q?.trim().slice(0, KB_SEARCH_MAX_CHARS);
  // `%foo%` matches any title containing the term; PG ILIKE is case-insensitive.
  // Crawled pages of one generation, so the knowledge tab shows the working KB
  // throughout a re-crawl instead of a half-built one. Manual documents are
  // listed separately (`listManualDocuments`), grouped per document.
  const inGeneration = crawledArticles(siteId, generation);
  const whereExpr = trimmedQ
    ? and(inGeneration, ilike(articles.title, `%${trimmedQ}%`))
    : inGeneration;

  const [rows, [totalRow]] = await Promise.all([
    db.query.articles.findMany({
      where: whereExpr,
      orderBy: [desc(articles.createdAt)],
      limit: safePageSize,
      offset,
    }),
    db.select({ value: count() }).from(articles).where(whereExpr),
  ]);

  const total = totalRow?.value ?? 0;
  return {
    rows,
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: total === 0 ? 1 : Math.ceil(total / safePageSize),
  };
}

export interface ManualDocumentSummary {
  id: string;
  /** The title the owner gave it — chunk titles carry a "(part n/m)" suffix. */
  title: string;
  parts: number;
  characters: number;
  createdAt: Date;
}

/**
 * The documents an owner pasted or uploaded, one row per document (however
 * many chunks it was split into), newest first.
 */
export async function listManualDocuments(
  siteId: string,
): Promise<ManualDocumentSummary[]> {
  const rows = await db
    .select({
      id: articles.manualDocumentId,
      title: min(articles.title),
      parts: count(),
      characters: sql<number>`sum(length(${articles.content}))::int`,
      createdAt: max(articles.createdAt),
    })
    .from(articles)
    .where(
      and(
        eq(articles.siteId, siteId),
        eq(articles.source, 'manual'),
        isNotNull(articles.manualDocumentId),
      ),
    )
    .groupBy(articles.manualDocumentId)
    .orderBy(desc(max(articles.createdAt)));

  return rows.flatMap((row) =>
    row.id && row.title && row.createdAt
      ? [
          {
            id: row.id,
            title: stripPartSuffix(row.title),
            parts: row.parts,
            characters: row.characters ?? 0,
            createdAt: row.createdAt,
          },
        ]
      : [],
  );
}

/** "Handbook (part 1/4)" → "Handbook". `min(title)` always lands on part 1. */
function stripPartSuffix(title: string): string {
  return title.replace(/\s+\(part \d+\/\d+\)$/, '');
}
