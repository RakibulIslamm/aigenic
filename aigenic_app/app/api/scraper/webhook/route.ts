import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { articles, sites } from '@/db/schema';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const articleEventSchema = z.object({
  event: z.literal('article'),
  siteId: z.string().uuid(),
  article: z.object({
    title: z.string().min(1).max(500),
    content: z.string().min(1).max(200_000),
    sourceUrl: z.string().url().optional(),
  }),
});

const completeEventSchema = z.object({
  event: z.literal('complete'),
  siteId: z.string().uuid(),
  totalPages: z.number().int().nonnegative().optional(),
});

const stoppedEventSchema = z.object({
  event: z.literal('stopped'),
  siteId: z.string().uuid(),
  totalPages: z.number().int().nonnegative().optional(),
});

const errorEventSchema = z.object({
  event: z.literal('error'),
  siteId: z.string().uuid(),
  error: z.string().max(2000).optional(),
});

const webhookSchema = z.discriminatedUnion('event', [
  articleEventSchema,
  completeEventSchema,
  stoppedEventSchema,
  errorEventSchema,
]);

export async function POST(request: NextRequest) {
  const expectedKey = env.SCRAPER_API_KEY;
  if (!expectedKey) {
    return NextResponse.json(
      { error: 'Scraper webhook not configured on this deployment' },
      { status: 503 }
    );
  }

  const providedKey = request.headers.get('x-api-key');
  if (!providedKey || providedKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const event = parsed.data;

  // Make sure the site exists before we touch anything else.
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, event.siteId),
  });
  if (!site) {
    return NextResponse.json({ error: 'Unknown siteId' }, { status: 404 });
  }

  switch (event.event) {
    case 'article': {
      await db.insert(articles).values({
        siteId: event.siteId,
        title: event.article.title,
        content: event.article.content,
        sourceUrl: event.article.sourceUrl ?? null,
      });
      // Keep status at 'crawling' until 'complete' arrives.
      if (site.kbStatus !== 'crawling') {
        await db
          .update(sites)
          .set({ kbStatus: 'crawling' })
          .where(eq(sites.id, event.siteId));
      }
      return NextResponse.json({ ok: true });
    }
    case 'complete': {
      await db
        .update(sites)
        .set({ kbStatus: 'ready', kbLastSyncedAt: new Date() })
        .where(eq(sites.id, event.siteId));
      return NextResponse.json({ ok: true });
    }
    case 'stopped': {
      // User aborted the crawl. Partial articles are kept and the KB is
      // marked ready so it can still be used. The optimistic update from the
      // server action usually wins; this is the safety net.
      await db
        .update(sites)
        .set({ kbStatus: 'ready', kbLastSyncedAt: new Date() })
        .where(eq(sites.id, event.siteId));
      return NextResponse.json({ ok: true });
    }
    case 'error': {
      await db
        .update(sites)
        .set({ kbStatus: 'failed' })
        .where(eq(sites.id, event.siteId));
      return NextResponse.json({ ok: true });
    }
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'aigenic-scraper-webhook' });
}
