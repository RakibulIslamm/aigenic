import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  articles,
  conversations,
  escalations,
  messages,
  sites,
  type Site,
} from '@/db/schema';

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

export async function getSiteForUser(
  siteId: string,
  userId: string
): Promise<Site | undefined> {
  return db.query.sites.findFirst({
    where: and(eq(sites.id, siteId), eq(sites.userId, userId)),
  });
}

export async function getSiteStats(siteId: string) {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

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

export async function listArticlesForSite(siteId: string) {
  return db.query.articles.findMany({
    where: eq(articles.siteId, siteId),
    orderBy: [desc(articles.createdAt)],
  });
}

export async function listConversationsForSite(
  siteId: string,
  limit = 50
) {
  const rows = await db
    .select({
      id: conversations.id,
      visitorId: conversations.visitorId,
      visitorEmail: conversations.visitorEmail,
      status: conversations.status,
      createdAt: conversations.createdAt,
      messageCount: sql<number>`count(${messages.id})::int`,
    })
    .from(conversations)
    .leftJoin(messages, eq(messages.conversationId, conversations.id))
    .where(eq(conversations.siteId, siteId))
    .groupBy(conversations.id)
    .orderBy(desc(conversations.createdAt))
    .limit(limit);

  return rows;
}
