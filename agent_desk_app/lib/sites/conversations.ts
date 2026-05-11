import { and, asc, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  conversations,
  escalations,
  messages,
  type Conversation,
  type Escalation,
  type Message,
} from '@/db/schema';

export type ConversationStatusFilter = 'all' | 'active' | 'resolved' | 'escalated';

export interface ConversationListItem {
  id: string;
  visitorId: string;
  visitorEmail: string | null;
  status: string;
  createdAt: Date;
  messageCount: number;
  preview: string | null;
}

/**
 * Lists conversations for a site, optionally filtered by status. The first
 * user message of each conversation is denormalized into `preview` so the
 * dashboard can render rows without a second N+1 round trip.
 */
export async function listConversationsFiltered(
  siteId: string,
  filter: ConversationStatusFilter = 'all',
  limit = 100
): Promise<ConversationListItem[]> {
  // Pull conversation rows + a count of messages in one query.
  const baseRows = await db
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
    .where(
      filter === 'all'
        ? eq(conversations.siteId, siteId)
        : and(
            eq(conversations.siteId, siteId),
            eq(conversations.status, filter)
          )
    )
    .groupBy(conversations.id)
    .orderBy(desc(conversations.createdAt))
    .limit(limit);

  if (baseRows.length === 0) return [];

  // For each conversation, fetch the earliest user message as the preview.
  const ids = baseRows.map((r) => r.id);
  const previewRows = await db
    .select({
      conversationId: messages.conversationId,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(inArray(messages.conversationId, ids), eq(messages.role, 'user'))
    )
    .orderBy(asc(messages.createdAt));

  const previewByConv = new Map<string, string>();
  for (const row of previewRows) {
    if (!previewByConv.has(row.conversationId)) {
      previewByConv.set(row.conversationId, row.content);
    }
  }

  return baseRows.map((row) => ({
    ...row,
    preview: previewByConv.get(row.id) ?? null,
  }));
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  escalation: Escalation | null;
  visitorStats: {
    firstSeen: Date;
    totalConversations: number;
  };
}

export async function getConversationDetail(
  conversationId: string,
  siteId: string
): Promise<ConversationDetail | null> {
  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, conversationId),
      eq(conversations.siteId, siteId)
    ),
  });
  if (!conversation) return null;

  const [transcript, escalation, visitorAgg] = await Promise.all([
    db.query.messages.findMany({
      where: eq(messages.conversationId, conversationId),
      orderBy: [asc(messages.createdAt)],
    }),
    db.query.escalations.findFirst({
      where: eq(escalations.conversationId, conversationId),
    }),
    db
      .select({
        firstSeen: sql<Date>`min(${conversations.createdAt})`,
        total: count(conversations.id),
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.siteId, siteId),
          eq(conversations.visitorId, conversation.visitorId)
        )
      ),
  ]);

  const visitorRow = visitorAgg[0];

  return {
    conversation,
    messages: transcript,
    escalation: escalation ?? null,
    visitorStats: {
      firstSeen: visitorRow?.firstSeen ?? conversation.createdAt,
      totalConversations: visitorRow?.total ?? 1,
    },
  };
}

export interface SiteAnalytics {
  monthlyConversations: number;
  monthlyEscalations: number;
  escalationRate: number;
  avgResolutionMinutes: number | null;
  topQueries: Array<{ query: string; count: number }>;
  daily: Array<{ date: string; conversations: number }>;
}

/**
 * Computes everything the analytics tab needs in a handful of round trips.
 * `daily` is a 30-day series with zero-filled gaps so the line chart doesn't
 * snap to the next non-zero day.
 */
export async function getSiteAnalytics(siteId: string): Promise<SiteAnalytics> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 29);
  thirtyDaysAgo.setUTCHours(0, 0, 0, 0);

  const [[monthlyConvAgg], [monthlyEscAgg], dailyRows, resolutionRows, toolRows] =
    await Promise.all([
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
        .innerJoin(
          conversations,
          eq(escalations.conversationId, conversations.id)
        )
        .where(
          and(
            eq(conversations.siteId, siteId),
            gte(escalations.createdAt, monthStart)
          )
        ),
      db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${conversations.createdAt}), 'YYYY-MM-DD')`,
          count: count(conversations.id),
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.siteId, siteId),
            gte(conversations.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(sql`date_trunc('day', ${conversations.createdAt})`)
        .orderBy(sql`date_trunc('day', ${conversations.createdAt})`),
      db
        .select({
          conversationId: messages.conversationId,
          firstAt: sql<Date>`min(${messages.createdAt})`,
          lastAt: sql<Date>`max(${messages.createdAt})`,
        })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(
          and(
            eq(conversations.siteId, siteId),
            eq(conversations.status, 'resolved'),
            gte(conversations.createdAt, monthStart)
          )
        )
        .groupBy(messages.conversationId),
      db
        .select({
          toolCalls: messages.toolCalls,
        })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(
          and(
            eq(conversations.siteId, siteId),
            gte(messages.createdAt, monthStart),
            sql`${messages.toolCalls} IS NOT NULL`
          )
        ),
    ]);

  const monthlyConversations = monthlyConvAgg?.value ?? 0;
  const monthlyEscalations = monthlyEscAgg?.value ?? 0;
  const escalationRate =
    monthlyConversations > 0 ? monthlyEscalations / monthlyConversations : 0;

  // Average resolution time: minutes between first and last message of resolved convos.
  let avgResolutionMinutes: number | null = null;
  if (resolutionRows.length > 0) {
    const totalMs = resolutionRows.reduce((sum, row) => {
      const first = row.firstAt instanceof Date ? row.firstAt.getTime() : new Date(row.firstAt).getTime();
      const last = row.lastAt instanceof Date ? row.lastAt.getTime() : new Date(row.lastAt).getTime();
      return sum + Math.max(0, last - first);
    }, 0);
    avgResolutionMinutes = totalMs / resolutionRows.length / 60_000;
  }

  // Top queries: extract from the search_knowledge_base tool inputs.
  const queryCounts = new Map<string, number>();
  for (const row of toolRows) {
    const calls = row.toolCalls;
    if (!Array.isArray(calls)) continue;
    for (const call of calls) {
      if (
        call &&
        typeof call === 'object' &&
        'toolName' in call &&
        call.toolName === 'search_knowledge_base' &&
        'input' in call &&
        call.input &&
        typeof call.input === 'object' &&
        'query' in call.input &&
        typeof call.input.query === 'string'
      ) {
        const normalized = call.input.query.trim().toLowerCase();
        if (!normalized) continue;
        queryCounts.set(normalized, (queryCounts.get(normalized) ?? 0) + 1);
      }
    }
  }
  const topQueries = [...queryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([query, count]) => ({ query, count }));

  // Zero-fill the 30-day series so missing days render as 0 on the line chart.
  const dailyMap = new Map<string, number>();
  for (const row of dailyRows) {
    dailyMap.set(row.day, Number(row.count));
  }
  const daily: Array<{ date: string; conversations: number }> = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(thirtyDaysAgo);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    daily.push({ date: key, conversations: dailyMap.get(key) ?? 0 });
  }

  return {
    monthlyConversations,
    monthlyEscalations,
    escalationRate,
    avgResolutionMinutes,
    topQueries,
    daily,
  };
}

/**
 * Counts conversations for a user across all their sites this calendar month.
 * Used to enforce the free-plan 100/mo cap before the chat endpoint runs the model.
 */
export async function countConversationsThisMonthForUser(
  userId: string
): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const rows = await db.execute(sql`
    select count(${conversations.id})::int as value
    from ${conversations}
    inner join sites on sites.id = ${conversations.siteId}
    where sites.user_id = ${userId}
      and ${conversations.createdAt} >= ${monthStart.toISOString()}
  `);
  // drizzle's execute returns a Postgres result with .rows
  const first = (rows as unknown as { rows: Array<{ value: number }> }).rows[0];
  return first?.value ?? 0;
}
