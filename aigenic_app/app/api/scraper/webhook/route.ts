import { NextResponse, type NextRequest } from 'next/server';
import { and, count, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { articles, crawlRuns, sites } from '@/db/schema';
import { env } from '@/lib/env';
import { decideSwap } from '@/lib/sites/generations';

/**
 * Refunds the manual-crawl quota slot that paid for the crawl now ending in
 * failure. Deleting the `crawl_runs` row is the refund (the quota is a count
 * of those rows); the site's `activeCrawlRunId` pointer clears via its
 * ON DELETE SET NULL. No-op when the crawl wasn't a manual re-crawl.
 */
async function refundCrawlClaim(
  tx: Pick<typeof db, 'delete'>,
  claimId: string | null,
): Promise<void> {
  if (!claimId) return;
  await tx.delete(crawlRuns).where(eq(crawlRuns.id, claimId));
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The crawl generation this event belongs to, echoed back from the `/crawl`
 * payload.
 *
 * Optional because the app and the scraper deploy independently: during the
 * window where this code is live and the VPS still runs the previous image,
 * events arrive without it. A missing generation is treated as "the crawl
 * currently in flight", which is exactly the old behavior. Once the scraper is
 * rolled out everywhere this can become required — until then, absence must not
 * mean "reject every article".
 */
const generationField = z.number().int().nonnegative().optional();

const articleEventSchema = z.object({
  event: z.literal('article'),
  siteId: z.string().uuid(),
  generation: generationField,
  article: z.object({
    title: z.string().min(1).max(500),
    content: z.string().min(1).max(200_000),
    sourceUrl: z.string().url().optional(),
  }),
});

const completeEventSchema = z.object({
  event: z.literal('complete'),
  siteId: z.string().uuid(),
  generation: generationField,
  totalPages: z.number().int().nonnegative().optional(),
});

const stoppedEventSchema = z.object({
  event: z.literal('stopped'),
  siteId: z.string().uuid(),
  generation: generationField,
  totalPages: z.number().int().nonnegative().optional(),
});

const errorEventSchema = z.object({
  event: z.literal('error'),
  siteId: z.string().uuid(),
  generation: generationField,
  error: z.string().max(2000).optional(),
  // Failure classification from the scraper's zero-page diagnosis. 'blocked'
  // drives the dashboard's "allow our crawler through your firewall" panel.
  code: z.enum(['blocked', 'unreachable', 'empty']).optional(),
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
      { status: 503 },
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
      { status: 400 },
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

  // An event with no generation belongs to the crawl in flight — see
  // `generationField`. Everything below compares against `crawlGeneration`, so
  // the shim keeps a pre-generation scraper working unchanged.
  const generation = event.generation ?? site.crawlGeneration;

  switch (event.event) {
    case 'article': {
      // A superseded crawl's articles would pile up in a generation nothing
      // reads, so drop them here rather than letting the next dispatch clean up.
      if (generation !== site.crawlGeneration) {
        return NextResponse.json({ ok: true, ignored: 'superseded' });
      }

      await db.transaction(async (tx) => {
        // Redelivery (our own webhook retries, or the scraper seeing the same
        // canonical URL twice) must not double the row — hence the upsert on
        // `(site_id, crawl_generation, source_url)`.
        await tx
          .insert(articles)
          .values({
            siteId: event.siteId,
            title: event.article.title,
            content: event.article.content,
            sourceUrl: event.article.sourceUrl ?? null,
            crawlGeneration: generation,
          })
          .onConflictDoUpdate({
            target: [articles.siteId, articles.crawlGeneration, articles.sourceUrl],
            set: { title: event.article.title, content: event.article.content },
          });

        // Only ever `pending` → `crawling`. Promoting from any status (what
        // this did before) meant one late webhook could drag a finished site
        // back to `crawling` and leave it spinning forever.
        if (site.kbStatus === 'pending') {
          await tx
            .update(sites)
            .set({ kbStatus: 'crawling' })
            .where(and(eq(sites.id, event.siteId), eq(sites.kbStatus, 'pending')));
        }
      });
      return NextResponse.json({ ok: true });
    }
    case 'complete':
    case 'stopped': {
      const counts = await countByGeneration(event.siteId, [
        generation,
        site.activeGeneration,
      ]);
      const decision = decideSwap({
        event: event.event,
        eventGeneration: generation,
        site,
        stagedCount: counts.get(generation) ?? 0,
        liveCount: counts.get(site.activeGeneration) ?? 0,
      });

      if (decision.action === 'ignore') {
        return NextResponse.json({ ok: true, ignored: decision.reason });
      }

      if (decision.action === 'keep') {
        // The crawl indexed nothing. The live KB (if any) is left alone; when
        // that verdict is a failure, record why so the dashboard can say more
        // than "failed", and refund the quota slot — a crawl that produced
        // nothing must not cost a re-crawl. This message is the back-compat
        // fallback — a current scraper diagnoses zero-page crawls itself and
        // sends `error` instead.
        await db.transaction(async (tx) => {
          await tx
            .update(sites)
            .set(
              decision.status === 'failed'
                ? {
                    kbStatus: decision.status,
                    kbLastError:
                      'The crawl finished without indexing any pages. The site may be blocking our crawler or have no readable content.',
                    kbLastErrorCode: 'empty',
                  }
                : // Stopped with a usable KB: the user's own click ended a
                  // crawl that did real work — the charge stands, detach only.
                  { kbStatus: decision.status, activeCrawlRunId: null },
            )
            .where(eq(sites.id, event.siteId));
          if (decision.status === 'failed') {
            await refundCrawlClaim(tx, site.activeCrawlRunId);
          }
        });
        return NextResponse.json({ ok: true, kept: decision.reason });
      }

      // The swap. Both statements in one transaction: a crash between them
      // would either serve a generation that's about to be deleted, or delete
      // the one still being served.
      await db.transaction(async (tx) => {
        await tx
          .update(sites)
          .set({
            activeGeneration: decision.generation,
            kbStatus: 'ready',
            kbLastSyncedAt: new Date(),
            // A successful crawl clears any stale failure explanation, and
            // detaches the quota claim WITHOUT deleting it — a completed
            // crawl is exactly what the quota counts.
            kbLastError: null,
            kbLastErrorCode: null,
            activeCrawlRunId: null,
          })
          .where(eq(sites.id, event.siteId));
        await tx
          .delete(articles)
          .where(
            and(
              eq(articles.siteId, event.siteId),
              ne(articles.crawlGeneration, decision.generation),
            ),
          );
      });
      return NextResponse.json({ ok: true });
    }
    case 'error': {
      if (generation !== site.crawlGeneration) {
        // A dead crawl's error must not fail a site that has since recrawled.
        return NextResponse.json({ ok: true, ignored: 'superseded' });
      }
      // The live KB is whatever `activeGeneration` points at and stays exactly
      // as it was — that is the whole point. Only the staging rows go — and
      // the quota slot comes back: a failed crawl is not a spent re-crawl.
      await db.transaction(async (tx) => {
        await tx
          .update(sites)
          .set({
            kbStatus: 'failed',
            kbLastError: event.error ?? 'The crawl failed for an unknown reason.',
            kbLastErrorCode: event.code ?? null,
          })
          .where(eq(sites.id, event.siteId));
        await refundCrawlClaim(tx, site.activeCrawlRunId);
        await tx
          .delete(articles)
          .where(
            and(
              eq(articles.siteId, event.siteId),
              ne(articles.crawlGeneration, site.activeGeneration),
            ),
          );
      });
      return NextResponse.json({ ok: true });
    }
  }
}

/**
 * Article counts for specific generations of one site, in a single round trip.
 * Generations absent from the result have no rows.
 */
async function countByGeneration(
  siteId: string,
  generations: number[],
): Promise<Map<number, number>> {
  const wanted = [...new Set(generations)];
  const rows = await db
    .select({ generation: articles.crawlGeneration, value: count() })
    .from(articles)
    .where(and(eq(articles.siteId, siteId), inArray(articles.crawlGeneration, wanted)))
    .groupBy(articles.crawlGeneration);
  return new Map(rows.map((row) => [row.generation, row.value]));
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'aigenic-scraper-webhook' });
}
