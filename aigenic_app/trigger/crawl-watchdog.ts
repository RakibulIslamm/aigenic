import { logger, schedules } from '@trigger.dev/sdk/v3';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

/**
 * A crawl with no sign of life for this long is declared dead. Long crawls
 * are fine — article webhooks count as progress — so this only catches
 * crawls that stopped *arriving*, not ones that are merely slow.
 */
const STUCK_AFTER_MINUTES = 30;

/**
 * Flips sites stranded in `pending`/`crawling` to `failed` when nothing has
 * happened for {@link STUCK_AFTER_MINUTES}: the VPS died mid-crawl, a
 * terminal webhook was lost, or a queued task evaporated. Without this, the
 * site spins forever and the "crawl already in progress" guard makes it
 * un-rescrapable — the user's only escape was asking us to poke the DB.
 *
 * "Progress" = the claim itself (`crawl_started_at`) or any article landing
 * in the generation this crawl writes into. `created_at` backstops rows from
 * before the column existed.
 */
export const crawlWatchdogTask = schedules.task({
  id: 'crawl-watchdog',
  cron: { pattern: '*/10 * * * *', timezone: 'UTC' },
  maxDuration: 120,
  run: async () => {
    const flipped = (await db.execute(sql`
      update sites
      set kb_status = 'failed', pending_crawl_run_id = null
      where kb_status in ('pending', 'crawling')
        and coalesce(crawl_started_at, created_at)
              < now() - make_interval(mins => ${STUCK_AFTER_MINUTES})
        and not exists (
          select 1 from articles
          where articles.site_id = sites.id
            and articles.crawl_generation = sites.crawl_generation
            and articles.created_at > now() - make_interval(mins => ${STUCK_AFTER_MINUTES})
        )
      returning id, kb_status
    `)) as unknown as Array<{ id: string }>;

    if (flipped.length > 0) {
      logger.warn(
        `Watchdog flipped ${flipped.length} stuck crawl(s) to failed — check the scraper VPS and webhook delivery`,
        { siteIds: flipped.map((r) => r.id) },
      );
    }

    return { flipped: flipped.length };
  },
});
