import { cache } from 'react';
import { and, count, desc, eq, gte, ilike, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  articles,
  conversations,
  escalations,
  sites,
  type Site,
} from '@/db/schema';
import { startOfCurrentMonthUTC } from '@/lib/dates';

export interface SiteListItem extends Site {
  articleCount: number;
  conversationCount: number;
}

export async function listSitesForUser(userId: string): Promise<SiteListItem[]> {
  const rows = await db
    .select({
      id: sites.id,
      userId: sites.userId,
      name: sites.name,
      domain: sites.domain,
      escalationEmail: sites.escalationEmail,
      widgetConfig: sites.widgetConfig,
      kbStatus: sites.kbStatus,
      kbLastSyncedAt: sites.kbLastSyncedAt,
      createdAt: sites.createdAt,
      articleCount: sql<number>`count(distinct ${articles.id})::int`,
      conversationCount: sql<number>`count(distinct ${conversations.id})::int`,
    })
    .from(sites)
    .leftJoin(articles, eq(articles.siteId, sites.id))
    .leftJoin(conversations, eq(conversations.siteId, sites.id))
    .where(eq(sites.userId, userId))
    .groupBy(sites.id)
    .orderBy(desc(sites.createdAt));

  return rows;
}

// Memoized per-request: the site layout + each tab page both reach for the
// same row, and we don't want N round trips per navigation.
export const getSiteForUser = cache(
  async (siteId: string, userId: string): Promise<Site | undefined> => {
    return db.query.sites.findFirst({
      where: and(eq(sites.id, siteId), eq(sites.userId, userId)),
    });
  }
);

export async function getSiteStats(siteId: string) {
  const monthStart = startOfCurrentMonthUTC();

  const [[articleAgg], [conversationAgg], [escalationAgg]] = await Promise.all([
    db
      .select({ value: count() })
      .from(articles)
      .where(eq(articles.siteId, siteId)),
    db
      .select({ value: count() })
      .from(conversations)
      .where(
        and(
          eq(conversations.siteId, siteId),
          gte(conversations.createdAt, monthStart)
        )
      ),
    db
      .select({ value: count() })
      .from(escalations)
      .innerJoin(conversations, eq(escalations.conversationId, conversations.id))
      .where(
        and(
          eq(conversations.siteId, siteId),
          gte(escalations.createdAt, monthStart)
        )
      ),
  ]);

  const articleCount = articleAgg?.value ?? 0;
  const conversationCount = conversationAgg?.value ?? 0;
  const escalationCount = escalationAgg?.value ?? 0;
  const escalationRate =
    conversationCount > 0 ? escalationCount / conversationCount : 0;

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
  { page, pageSize, q }: { page: number; pageSize: number; q?: string }
): Promise<ArticlePage> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize) || 25));
  const offset = (safePage - 1) * safePageSize;
  const trimmedQ = q?.trim();
  // `%foo%` matches any title containing the term; PG ILIKE is case-insensitive.
  const whereExpr = trimmedQ
    ? and(eq(articles.siteId, siteId), ilike(articles.title, `%${trimmedQ}%`))
    : eq(articles.siteId, siteId);

  const [rows, [totalRow]] = await Promise.all([
    db.query.articles.findMany({
      where: whereExpr,
      orderBy: [desc(articles.createdAt)],
      limit: safePageSize,
      offset,
    }),
    db
      .select({ value: count() })
      .from(articles)
      .where(whereExpr),
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

