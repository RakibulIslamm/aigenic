import { cache } from 'react';
import { and, count, desc, eq, gte, ilike, sql } from 'drizzle-orm';
import { db, withDbRetry } from '@/db';
import { articles, conversations, escalations, sites, type Site } from '@/db/schema';
import { startOfCurrentMonthUTC } from '@/lib/dates';
import { isUuid } from '@/lib/ids';
import { articlesInGeneration } from '@/lib/sites/generations';
import { KB_PAGE_SIZE, KB_SEARCH_MAX_CHARS } from '@/lib/sites/limits';

export interface SiteListItem extends Site {
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
        createdAt: sites.createdAt,
        updatedAt: sites.updatedAt,
        articleCount: sql<number>`count(distinct ${articles.id})::int`,
        conversationCount: sql<number>`count(distinct ${conversations.id})::int`,
      })
      .from(sites)
      // Only the generation each site serves — mid-crawl staging rows must not
      // inflate the count the owner sees on the dashboard.
      .leftJoin(
        articles,
        and(
          eq(articles.siteId, sites.id),
          eq(articles.crawlGeneration, sites.activeGeneration),
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
 * `generation` decides which articles are counted — pass the site's
 * `activeGeneration` for the KB it serves, or `crawlGeneration` to report the
 * progress of a crawl in flight. Callers always have the site row already.
 */
export async function getSiteStats(siteId: string, generation: number) {
  const monthStart = startOfCurrentMonthUTC();

  const [[articleAgg], [conversationAgg], [escalationAgg]] = await Promise.all([
    db
      .select({ value: count() })
      .from(articles)
      .where(articlesInGeneration(siteId, generation)),
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
  // Scoped to one generation, so the knowledge tab shows the working KB
  // throughout a re-crawl instead of a half-built one.
  const inGeneration = articlesInGeneration(siteId, generation);
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
