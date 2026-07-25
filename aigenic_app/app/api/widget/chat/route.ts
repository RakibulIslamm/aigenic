import { type NextRequest } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ModelMessage } from 'ai';
import { db } from '@/db';
import { conversations, messages, sites, users } from '@/db/schema';
import { runSupportAgent } from '@/lib/agent/support-agent';
import { DEFAULT_WIDGET_CONFIG } from '@/lib/sites/schemas';
import { countConversationsThisMonthForUser } from '@/lib/sites/conversations';
import { getPlan } from '@/lib/billing/plans';
import { widgetCors } from '@/lib/http/cors';
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

const cors = widgetCors('POST, OPTIONS');

export function OPTIONS() {
  return cors.preflight();
}

export async function POST(request: NextRequest) {
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

  // 1. Find the site so we have its widget config + name for the prompt.
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  if (!site) return jsonError('Site not found', 404);

  // 2. Resolve / create the conversation row.
  if (conversationId) {
    const existing = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
    });
    if (!existing || existing.siteId !== siteId) {
      return jsonError('Conversation does not belong to this site', 403);
    }
  } else {
    // Hard-cap conversations only for plans that opt into enforcement (Free).
    // Paid plans allow overage — those conversations are metered, not blocked,
    // so existing customers never get a "limit reached" surprise mid-month.
    const owner = await db.query.users.findFirst({
      where: eq(users.id, site.userId),
    });
    if (owner) {
      const plan = getPlan(owner.plan);
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

  // 3. Persist the visitor's message before we kick off the model.
  await db.insert(messages).values({
    conversationId,
    role: 'user',
    content: userMessage,
  });

  // 4. Reload the full transcript as ModelMessages.
  const history = await loadHistory(conversationId);

  if (!env.OPENROUTER_API_KEY) {
    return jsonError('OPENROUTER_API_KEY is not configured on this deployment.', 503);
  }

  // 5. Run the agent.
  const widgetConfig = site.widgetConfig ?? DEFAULT_WIDGET_CONFIG;
  const agentResult = runSupportAgent({
    context: { siteId, conversationId, visitorId },
    prompt: {
      siteName: site.name,
      botName: widgetConfig.botName,
      greeting: widgetConfig.greeting,
    },
    history,
    abortSignal: request.signal,
  });

  // 6. Stream a tiny custom SSE format the widget understands.
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

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}
