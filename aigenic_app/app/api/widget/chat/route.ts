import { NextResponse, type NextRequest } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ModelMessage } from 'ai';
import { db } from '@/db';
import { conversations, messages, sites, users } from '@/db/schema';
import { runSupportAgent } from '@/lib/agent/support-agent';
import { DEFAULT_WIDGET_CONFIG } from '@/lib/sites/schemas';
import {
  countConversationsForVisitorSince,
  countConversationsThisMonthForUser,
  countMessagesForConversation,
  countMessagesThisMonthForSite,
} from '@/lib/sites/conversations';
import { getPlan } from '@/lib/billing/plans';
import { widgetCors } from '@/lib/http/cors';
import { clientIp, consumeRateLimit } from '@/lib/ratelimit';
import { env } from '@/lib/env';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const requestSchema = z.object({
  siteId: z.string().uuid(),
  // Accept null too — the widget sends `null` on the first message of a
  // session, before any conversation exists.
  conversationId: z.string().uuid().nullish(),
  visitorId: z.string().min(8).max(128),
  message: z.string().trim().min(1).max(4000),
});

/**
 * Abuse gates for the one unauthenticated endpoint that spends LLM money.
 * All of them run before the model; the counters live in Postgres via
 * `lib/ratelimit.ts`. Numbers are deliberately far above real support-widget
 * usage — they exist to bound a hostile client, not to squeeze a chatty one.
 */
const IP_BURST = { limit: 20, windowSeconds: 10 };
const IP_SUSTAINED = { limit: 200, windowSeconds: 60 * 60 };
/**
 * Per-site request ceiling: even a botnet rotating IPs can't spend more than
 * this many turns of one tenant's LLM budget per hour.
 */
const SITE_HOURLY = { limit: 600, windowSeconds: 60 * 60 };
/** Hard length cap per conversation, counting stored user+assistant rows. */
const MAX_MESSAGES_PER_CONVERSATION = 50;
/** How many fresh conversations one visitor may open on a site per hour. */
const MAX_CONVERSATIONS_PER_VISITOR_PER_HOUR = 5;
/**
 * Monthly per-site message budget = plan's conversation quota × this. Checked
 * on every turn, so reusing an old conversation counts against it too —
 * previously only conversation *creation* was capped, which a kept-alive
 * conversationId bypassed entirely.
 */
const BUDGET_MESSAGES_PER_CONVERSATION = 20;

const cors = widgetCors('POST, OPTIONS');

export function OPTIONS() {
  return cors.preflight();
}

export async function POST(request: NextRequest) {
  // 0. Per-IP gates — the cheapest rejection, before the body is even read.
  const ip = clientIp(request);
  const [burst, sustained] = await Promise.all([
    consumeRateLimit({ key: `chat:ip:10s:${ip}`, ...IP_BURST }),
    consumeRateLimit({ key: `chat:ip:1h:${ip}`, ...IP_SUSTAINED }),
  ]);
  if (!burst.ok || !sustained.ok) {
    const gate = !burst.ok ? burst : sustained;
    return rateLimited('Too many requests. Please slow down.', gate.retryAfterSeconds);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('Invalid payload', 400, { issues: parsed.error.issues });
  }

  const { siteId, visitorId, message: userMessage } = parsed.data;
  let conversationId = parsed.data.conversationId ?? undefined;

  // 1. Per-site request ceiling — keyed on the validated siteId, before any
  //    row for it is even looked up.
  const siteGate = await consumeRateLimit({
    key: `chat:site:1h:${siteId}`,
    ...SITE_HOURLY,
  });
  if (!siteGate.ok) {
    return rateLimited(
      'This assistant is receiving too many requests right now. Please try again shortly.',
      siteGate.retryAfterSeconds,
    );
  }

  // 2. Find the site so we have its widget config + name for the prompt.
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  if (!site) return jsonError('Site not found', 404);

  // 3. Monthly per-site message budget, on EVERY turn — creation and reuse
  //    alike. Free plans enforce hard; paid plans meter overage (log, don't
  //    block), matching how the conversation cap below already treats them.
  const owner = await db.query.users.findFirst({
    where: eq(users.id, site.userId),
  });
  const plan = owner ? getPlan(owner.plan) : null;
  if (plan && Number.isFinite(plan.limits.conversationsPerMonth)) {
    const budget = plan.limits.conversationsPerMonth * BUDGET_MESSAGES_PER_CONVERSATION;
    const used = await countMessagesThisMonthForSite(siteId);
    if (used >= budget) {
      if (plan.limits.enforceConversationLimit) {
        return jsonError(
          'This site is at its monthly usage limit. Please come back next month or contact the team.',
          429,
        );
      }
      log.info('site over monthly message budget (metered, not blocked)', {
        siteId,
        used,
        budget,
        plan: plan.id,
      });
    }
  }

  // 4. Resolve / create the conversation row.
  if (conversationId) {
    const existing = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
    });
    if (!existing || existing.siteId !== siteId) {
      return jsonError('Conversation does not belong to this site', 403);
    }

    // Hard length cap: a single conversation can't be replayed forever as a
    // free LLM channel (also bounds Phase 4's history replay).
    const messageCount = await countMessagesForConversation(conversationId);
    if (messageCount >= MAX_MESSAGES_PER_CONVERSATION) {
      return jsonError(
        'This conversation has reached its length limit. Please start a new chat.',
        429,
      );
    }
  } else {
    // One visitor minting conversations in a loop dodges the per-conversation
    // cap — bound the minting rate itself.
    const recentConversations = await countConversationsForVisitorSince(
      siteId,
      visitorId,
      new Date(Date.now() - 60 * 60 * 1000),
    );
    if (recentConversations >= MAX_CONVERSATIONS_PER_VISITOR_PER_HOUR) {
      return rateLimited(
        'Too many new conversations. Please continue in an existing chat or try again later.',
        60 * 60,
      );
    }

    // Hard-cap conversations only for plans that opt into enforcement (Free).
    // Paid plans allow overage — those conversations are metered, not blocked,
    // so existing customers never get a "limit reached" surprise mid-month.
    if (owner && plan) {
      if (
        plan.limits.enforceConversationLimit &&
        Number.isFinite(plan.limits.conversationsPerMonth)
      ) {
        const used = await countConversationsThisMonthForUser(owner.id);
        if (used >= plan.limits.conversationsPerMonth) {
          return jsonError(
            'This site is at its monthly conversation limit. Please come back next month or contact the team.',
            429,
          );
        }
      }
    }

    const [created] = await db
      .insert(conversations)
      .values({ siteId, visitorId, status: 'active' })
      .returning({ id: conversations.id });
    if (!created) return jsonError('Could not create conversation', 500);
    conversationId = created.id;
  }

  // 5. Persist the visitor's message before we kick off the model.
  await db.insert(messages).values({
    conversationId,
    role: 'user',
    content: userMessage,
  });

  // 6. Reload the full transcript as ModelMessages.
  const history = await loadHistory(conversationId);

  if (!env.OPENROUTER_API_KEY) {
    return jsonError('OPENROUTER_API_KEY is not configured on this deployment.', 503);
  }

  // 7. Run the agent.
  const widgetConfig = site.widgetConfig ?? DEFAULT_WIDGET_CONFIG;
  const agentResult = runSupportAgent({
    context: {
      siteId,
      conversationId,
      visitorId,
      activeGeneration: site.activeGeneration,
    },
    prompt: {
      siteName: site.name,
      botName: widgetConfig.botName,
      greeting: widgetConfig.greeting,
    },
    history,
    abortSignal: request.signal,
  });

  // 8. Stream a tiny custom SSE format the widget understands.
  const stream = buildSseStream({
    agentResult,
    conversationId,
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...cors.headers,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function buildSseStream({
  agentResult,
  conversationId,
}: {
  agentResult: ReturnType<typeof runSupportAgent>;
  conversationId: string;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  function send(
    controller: ReadableStreamDefaultController<Uint8Array>,
    payload: unknown,
  ) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // Tell the widget the conversation id immediately so it can persist
      // before the first token arrives.
      send(controller, { type: 'meta', conversationId });

      let assistantText = '';
      const toolCalls: Array<{
        toolName: string;
        toolCallId: string;
        input: unknown;
        output?: unknown;
      }> = [];

      try {
        for await (const part of agentResult.fullStream) {
          switch (part.type) {
            case 'text-delta': {
              assistantText += part.text;
              send(controller, { type: 'text', delta: part.text });
              break;
            }
            case 'tool-call': {
              toolCalls.push({
                toolName: part.toolName,
                toolCallId: part.toolCallId,
                input: part.input,
              });
              send(controller, { type: 'tool', name: part.toolName, status: 'running' });
              break;
            }
            case 'tool-result': {
              const existing = toolCalls.find((t) => t.toolCallId === part.toolCallId);
              if (existing) existing.output = part.output;
              send(controller, { type: 'tool', name: part.toolName, status: 'done' });
              break;
            }
            case 'tool-error': {
              const existing = toolCalls.find((t) => t.toolCallId === part.toolCallId);
              if (existing) existing.output = { error: String(part.error) };
              send(controller, { type: 'tool', name: part.toolName, status: 'error' });
              break;
            }
            case 'error': {
              send(controller, {
                type: 'error',
                message: extractErrorMessage(part.error),
              });
              break;
            }
            case 'abort': {
              send(controller, { type: 'error', message: 'Request aborted' });
              break;
            }
          }
        }

        // Persist the final assistant message + collected tool calls.
        if (assistantText.length > 0 || toolCalls.length > 0) {
          await db.insert(messages).values({
            conversationId,
            role: 'assistant',
            content: assistantText,
            toolCalls: toolCalls.length > 0 ? toolCalls : null,
          });
        }

        send(controller, { type: 'done', conversationId });
      } catch (err) {
        log.error('chat stream failed', { err });
        send(controller, { type: 'error', message: extractErrorMessage(err) });
      } finally {
        controller.close();
      }
    },
  });
}

async function loadHistory(conversationId: string): Promise<ModelMessage[]> {
  const rows = await db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: [asc(messages.createdAt)],
  });

  // Drop tool-call detail from history — we only need the textual transcript
  // for the next turn. Each user/assistant message becomes a clean ModelMessage.
  return rows
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) =>
      m.role === 'user'
        ? ({ role: 'user', content: m.content } as ModelMessage)
        : ({ role: 'assistant', content: m.content } as ModelMessage),
    );
}

const jsonError = cors.jsonError;

/** 429 with `Retry-After`, keeping the widget's permissive CORS headers. */
function rateLimited(message: string, retryAfterSeconds: number) {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: { ...cors.headers, 'Retry-After': String(retryAfterSeconds) },
    },
  );
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}
