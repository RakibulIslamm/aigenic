import { and, count, eq, gte } from 'drizzle-orm';
import { db } from '@/db';
import { crawlRuns } from '@/db/schema';

export type CrawlKind = 'manual' | 'scheduled';

/**
 * Counts crawl runs for a user with `kind = 'manual'` since `since`.
 * Used to enforce per-plan manual-crawl quotas in [rescrapeSiteAction].
 */
export async function countManualCrawlsForUserSince(
  userId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(crawlRuns)
    .where(
      and(
        eq(crawlRuns.userId, userId),
        eq(crawlRuns.kind, 'manual'),
        gte(crawlRuns.createdAt, since),
      ),
    );
  return row?.value ?? 0;
}

/**
 * Inserts one crawl_runs row and returns its id, so the caller can roll back
 * the quota claim if the subsequent task trigger fails.
 */
export async function recordCrawlRun(params: {
  userId: string;
  siteId: string;
  kind: CrawlKind;
}): Promise<string> {
  const [row] = await db
    .insert(crawlRuns)
    .values({
      userId: params.userId,
      siteId: params.siteId,
      kind: params.kind,
    })
    .returning({ id: crawlRuns.id });
  return row!.id;
}

/** Bulk insert. Skips the work when items is empty. */
export async function recordCrawlRunsBulk(
  items: Array<{ userId: string; siteId: string; kind: CrawlKind }>,
): Promise<void> {
  if (items.length === 0) return;
  await db.insert(crawlRuns).values(items);
}

/** Rollback helper for the manual-quota path. */
export async function deleteCrawlRun(id: string): Promise<void> {
  await db.delete(crawlRuns).where(eq(crawlRuns.id, id));
}
