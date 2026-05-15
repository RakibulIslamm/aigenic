import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/auth/user';
import {
  diffSnapshots,
  fetchCrawlSnapshot,
  isTerminalStatus,
  type CrawlEvent,
  type CrawlSnapshot,
} from '@/lib/sites/crawl-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const POLL_MS = 1500;
const HEARTBEAT_MS = 25_000;
// Auto-close after this much idle time on a terminal state so the connection
// doesn't sit open burning the function budget once nothing else will change.
const TERMINAL_LINGER_MS = 5_000;

const paramsSchema = z.object({ siteId: z.string().uuid() });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid siteId' }, { status: 400 });
  }
  const { siteId } = parsed.data;

  const userId = await requireUserId();
  const initial = await fetchCrawlSnapshot(siteId, userId);
  if (!initial) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Initial snapshot — primes the client UI immediately.
      send({ type: 'snapshot', snapshot: initial });

      let prev: CrawlSnapshot = initial;
      let terminalSince: number | null = isTerminalStatus(initial.status)
        ? Date.now()
        : null;

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      const stopAll = () => {
        clearInterval(heartbeat);
        clearInterval(poll);
        close();
      };

      request.signal.addEventListener('abort', stopAll, { once: true });

      const poll = setInterval(async () => {
        if (closed) return stopAll();
        try {
          const next = await fetchCrawlSnapshot(siteId, userId);
          if (!next) {
            send({ type: 'error', message: 'Site no longer accessible' });
            return stopAll();
          }

          const events: CrawlEvent[] = diffSnapshots(prev, next);
          if (events.length > 0) {
            send({ type: 'events', events, snapshot: next });
          } else if (next.articleCount !== prev.articleCount || next.status !== prev.status) {
            send({ type: 'snapshot', snapshot: next });
          }

          prev = next;

          if (isTerminalStatus(next.status)) {
            if (terminalSince == null) terminalSince = Date.now();
            if (Date.now() - terminalSince >= TERMINAL_LINGER_MS) {
              send({ type: 'done' });
              return stopAll();
            }
          } else {
            terminalSince = null;
          }
        } catch (err) {
          send({
            type: 'error',
            message: err instanceof Error ? err.message : 'Snapshot failed',
          });
        }
      }, POLL_MS);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
