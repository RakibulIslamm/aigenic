import { tool } from 'ai';
import { z } from 'zod';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { articles, conversations, escalations, messages, sites } from '@/db/schema';
import { ESCALATION_FROM_ADDRESS, getResendClient } from '@/lib/email/resend';
import { log } from '@/lib/log';

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
              eq(articles.siteId, ctx.siteId),
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
          where: and(eq(articles.id, articleId), eq(articles.siteId, ctx.siteId)),
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

        // Flip the conversation to escalated; record the visitor email too if
        // the model captured one.
        await db
          .update(conversations)
          .set({ status: 'escalated', ...(visitorEmail ? { visitorEmail } : {}) })
          .where(eq(conversations.id, ctx.conversationId));

        // One escalation per conversation — the unique constraint enforces
        // this; onConflictDoNothing makes a re-call idempotent.
        await db
          .insert(escalations)
          .values({
            conversationId: ctx.conversationId,
            reason,
          })
          .onConflictDoNothing({ target: escalations.conversationId });

        const transcript = await db.query.messages.findMany({
          where: eq(messages.conversationId, ctx.conversationId),
          orderBy: [asc(messages.createdAt)],
        });

        const transcriptHtml = renderTranscriptHtml(
          transcript.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        );

        const resend = getResendClient();
        let emailSent = false;

        if (resend) {
          try {
            await resend.emails.send({
              from: ESCALATION_FROM_ADDRESS,
              to: site.escalationEmail,
              replyTo: visitorEmail ?? undefined,
              subject: `[Aigenic] Escalation from ${site.name}`,
              html: renderEscalationEmail({
                siteName: site.name,
                reason,
                visitorEmail: visitorEmail ?? null,
                visitorId: ctx.visitorId,
                conversationId: ctx.conversationId,
                transcriptHtml,
              }),
            });
            emailSent = true;
            await db
              .update(escalations)
              .set({ emailSentAt: new Date() })
              .where(eq(escalations.conversationId, ctx.conversationId));
          } catch (err) {
            log.error('Failed to send escalation email', { err });
          }
        }

        return {
          ok: true as const,
          emailSent,
          message: emailSent
            ? "I've forwarded this to the support team — they'll follow up by email within one business day. Anything else I can help with in the meantime?"
            : "I've flagged this for the support team. They'll follow up shortly. Anything else I can help with?",
        };
      },
    }),
  };
}

function renderTranscriptHtml(msgs: Array<{ role: string; content: string }>): string {
  return msgs
    .map((m) => {
      const who = m.role === 'assistant' ? 'Bot' : m.role === 'user' ? 'Visitor' : m.role;
      const escaped = escapeHtml(m.content);
      return `<p style="margin:0 0 12px;"><strong>${who}:</strong> ${escaped}</p>`;
    })
    .join('');
}

function renderEscalationEmail(args: {
  siteName: string;
  reason: string;
  visitorEmail: string | null;
  visitorId: string;
  conversationId: string;
  transcriptHtml: string;
}): string {
  return `<!doctype html>
<html>
  <body style="font-family: ui-sans-serif, system-ui, sans-serif; color:#18181b; max-width:640px; margin:0 auto; padding:24px;">
    <h2 style="margin:0 0 8px; font-weight:600;">New escalation from ${escapeHtml(args.siteName)}</h2>
    <p style="margin:0 0 16px; color:#71717a;">An Aigenic visitor was escalated to your team.</p>

    <div style="border:1px solid #e4e4e7; border-radius:12px; padding:16px; margin:16px 0;">
      <p style="margin:0 0 6px;"><strong>Reason:</strong> ${escapeHtml(args.reason)}</p>
      <p style="margin:0 0 6px;"><strong>Visitor email:</strong> ${args.visitorEmail ? escapeHtml(args.visitorEmail) : '<em>not provided</em>'}</p>
      <p style="margin:0;"><strong>Conversation ID:</strong> <code>${escapeHtml(args.conversationId)}</code></p>
    </div>

    <h3 style="margin:24px 0 8px; font-weight:600;">Transcript</h3>
    <div style="border:1px solid #e4e4e7; border-radius:12px; padding:16px; background:#fafafa;">
      ${args.transcriptHtml}
    </div>

    <p style="margin:24px 0 0; font-size:12px; color:#a1a1aa;">Sent by Aigenic · visitorId ${escapeHtml(args.visitorId)}</p>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
