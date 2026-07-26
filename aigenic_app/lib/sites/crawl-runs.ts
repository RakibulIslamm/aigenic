import { and, count, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { crawlRuns, sites } from '@/db/schema';

export type CrawlKind = 'manual' | 'scheduled';

/**
 * Atomically checks the manual-crawl quota and claims a slot. The
 * count-then-insert runs inside one transaction holding a per-user advisory
 * lock, so two rapid rescrapes can't both read "0 used" and both claim the
 * last slot — the second waits on the lock and then sees the first's row.
 *
 * Returns the claimed `crawl_runs` id, or `null` when the quota is spent
 * (nothing inserted). The claim is released with [deleteCrawlRun] if the
 * dispatch it paid for never happens.
 */
export async function claimManualCrawlSlot(params: {
  userId: string;
  siteId: string;
  since: Date;
  limit: number;
}): Promise<string | null> {
  const { userId, siteId, since, limit } = params;
  return db.transaction(async (tx) => {
    // hashtext() folds the user id into the int key space the advisory-lock
    // API wants; xact-scoped, so it releases itself on commit/rollback.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    const [row] = await tx
      .select({ value: count() })
      .from(crawlRuns)
      .where(
        and(
          eq(crawlRuns.userId, userId),
          eq(crawlRuns.kind, 'manual'),
          gte(crawlRuns.createdAt, since),
        ),
      );
    if ((row?.value ?? 0) >= limit) return null;

    const [claimed] = await tx
      .insert(crawlRuns)
      .values({ userId, siteId, kind: 'manual' })
      .returning({ id: crawlRuns.id });

    // Remember which claim pays for this crawl, so every failure path can
    // refund exactly that row — a slot is only spent by a crawl that
    // completes (see the schema comment on `activeCrawlRunId`).
    await tx
      .update(sites)
      .set({ activeCrawlRunId: claimed!.id })
      .where(eq(sites.id, siteId));

    return claimed!.id;
  });
}

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
