import { NextResponse, type NextRequest } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ModelMessage } from 'ai';
import { db } from '@/db';
import { conversations, messages, sites } from '@/db/schema';
import { runSupportAgent } from '@/lib/agent/support-agent';
import { DEFAULT_WIDGET_CONFIG } from '@/lib/sites/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const requestSchema = z.object({
  siteId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  visitorId: z.string().min(8).max(128),
  message: z.string().trim().min(1).max(4000),
});

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
} as const;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
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
  let conversationId = parsed.data.conversationId;

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

  if (!process.env.OPENROUTER_API_KEY) {
    return jsonError(
      'OPENROUTER_API_KEY is not configured on this deployment.',
      503
    );
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
      ...CORS_HEADERS,
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

  function send(controller: ReadableStreamDefaultController<Uint8Array>, payload: unknown) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // Tell the widget the conversation id immediately so it can persist
      // before the first token arrives.
      send(controller, { type: 'meta', conversationId });

      let assistantText = '';
      const toolCalls: Array<{ toolName: string; toolCallId: string; input: unknown; output?: unknown }> = [];

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
              send(controller, { type: 'error', message: extractErrorMessage(part.error) });
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
        console.error('chat stream failed', err);
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
        : ({ role: 'assistant', content: m.content } as ModelMessage)
    );
}

function jsonError(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { error, ...extra },
    {
      status,
      headers: CORS_HEADERS,
    }
  );
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}
