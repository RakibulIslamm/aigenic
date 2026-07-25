import { tool } from 'ai';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { articles, conversations, escalations, sites } from '@/db/schema';
import { deliverEscalationEmail } from '@/lib/email/escalation';
import { articlesInGeneration } from '@/lib/sites/generations';

/** How many articles a full-text search returns to the model. */
const FTS_RESULT_LIMIT = 5;
/** Characters of article content shown in a search-result excerpt. */
const SEARCH_EXCERPT_CHARS = 320;

/**
 * Tools share an immutable per-request context (siteId, conversationId,
 * visitorId) that the route handler binds via `buildSupportTools(...)`.
 * Keeping it in a closure keeps the LLM's tool inputs minimal — no need to
 * pass siteId on every call.
 */
export interface SupportToolContext {
  siteId: string;
  conversationId: string;
  visitorId: string;
  /**
   * The article generation this site serves. Read from the site row the chat
   * route already loaded, so the bot answers from the live knowledge base and
   * never from a crawl that's still streaming in. See `lib/sites/generations.ts`.
   */
  activeGeneration: number;
}

export function buildSupportTools(ctx: SupportToolContext) {
  return {
    search_knowledge_base: tool({
      description: `Full-text search the site's knowledge base. Always call this BEFORE answering any product-specific question. Returns the top ${FTS_RESULT_LIMIT} articles ranked by relevance.`,
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(500)
          .describe(
            'A short keyword query — 2–6 words works best, e.g. "reset password" or "billing refund".',
          ),
      }),
      execute: async ({ query }) => {
        const trimmed = query.trim();
        if (!trimmed) {
          return {
            results: [] as Array<{
              id: string;
              title: string;
              excerpt: string;
              sourceUrl: string | null;
              rank: number;
            }>,
          };
        }

        // ts_rank against the generated content_tsv column. plainto_tsquery
        // safely handles arbitrary user input (no manual quoting needed).
        const rows = await db
          .select({
            id: articles.id,
            title: articles.title,
            content: articles.content,
            sourceUrl: articles.sourceUrl,
            rank: sql<number>`ts_rank(${articles.contentTsv}, plainto_tsquery('english', ${trimmed}))`,
          })
          .from(articles)
          .where(
            and(
              // The generation the site serves — never a crawl in progress.
              // Without this the bot would answer from a half-built KB the
              // owner can't even see yet.
              articlesInGeneration(ctx.siteId, ctx.activeGeneration),
              sql`${articles.contentTsv} @@ plainto_tsquery('english', ${trimmed})`,
            ),
          )
          .orderBy(
            sql`ts_rank(${articles.contentTsv}, plainto_tsquery('english', ${trimmed})) DESC`,
          )
          .limit(FTS_RESULT_LIMIT);

        return {
          query: trimmed,
          results: rows.map((row) => ({
            id: row.id,
            title: row.title,
            excerpt:
              row.content.slice(0, SEARCH_EXCERPT_CHARS) +
              (row.content.length > SEARCH_EXCERPT_CHARS ? '…' : ''),
            sourceUrl: row.sourceUrl,
            rank: Number(row.rank ?? 0),
          })),
        };
      },
    }),

    get_article: tool({
      description:
        'Read a single knowledge-base article in full. Use this after search_knowledge_base when an excerpt looks promising and you need the whole content to answer accurately.',
      inputSchema: z.object({
        articleId: z
          .string()
          .uuid()
          .describe('The id returned by search_knowledge_base.'),
      }),
      execute: async ({ articleId }) => {
        const article = await db.query.articles.findFirst({
          where: and(
            eq(articles.id, articleId),
            articlesInGeneration(ctx.siteId, ctx.activeGeneration),
          ),
        });
        if (!article) {
          return { found: false as const, message: 'Article not found.' };
        }
        return {
          found: true as const,
          id: article.id,
          title: article.title,
          content: article.content,
          sourceUrl: article.sourceUrl,
        };
      },
    }),

    escalate_to_human: tool({
      description:
        "Escalate the current conversation to a human teammate by email. Only use when: (1) the user explicitly asks for a human, (2) it's a billing/account/refund issue you cannot resolve, or (3) the question is clearly outside the product's scope. Never escalate before trying search_knowledge_base.",
      inputSchema: z.object({
        reason: z
          .string()
          .min(5)
          .max(500)
          .describe(
            'One short sentence explaining WHY this needs a human. E.g. "User requesting refund for last month\'s charge."',
          ),
        visitorEmail: z
          .string()
          .email()
          .optional()
          .describe(
            "The visitor's email if they have provided one. Leave empty if unknown — do not invent one.",
          ),
      }),
      execute: async ({ reason, visitorEmail }) => {
        const site = await db.query.sites.findFirst({
          where: eq(sites.id, ctx.siteId),
        });
        if (!site) {
          return {
            ok: false as const,
            message: 'Could not find this site to escalate to.',
          };
        }

        // Status flip + escalation insert commit or fail together, so an
        // `escalated` conversation can never exist without its reason row.
        // returning() says whether THIS call created the row — a re-call
        // hits the unique constraint and comes back empty, and must not
        // email the owner a second time.
        const inserted = await db.transaction(async (tx) => {
          await tx
            .update(conversations)
            .set({ status: 'escalated', ...(visitorEmail ? { visitorEmail } : {}) })
            .where(eq(conversations.id, ctx.conversationId));

          const rows = await tx
            .insert(escalations)
            .values({
              conversationId: ctx.conversationId,
              reason,
            })
            .onConflictDoNothing({ target: escalations.conversationId })
            .returning({ id: escalations.id });
          return rows.length > 0;
        });

        if (!inserted) {
          return {
            ok: true as const,
            emailSent: false,
            alreadyEscalated: true as const,
            message:
              'This conversation is already escalated — the support team has it on file. No need to escalate again.',
          };
        }

        const delivery = await deliverEscalationEmail(ctx.conversationId);

        // The messages are honest about what actually happened: a confirmed
        // send may promise human follow-up; a failed or unconfigured send
        // only claims what is true — the request is logged, visible in the
        // dashboard, and will be retried.
        return {
          ok: true as const,
          emailSent: delivery.sent,
          message: delivery.sent
            ? "I've forwarded this to the support team — they'll follow up by email within one business day. Anything else I can help with in the meantime?"
            : "I've logged this for the support team to review. Anything else I can help with in the meantime?",
        };
      },
    }),
  };
}
