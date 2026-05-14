import { idempotencyKeys, logger, schedules } from '@trigger.dev/sdk/v3';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { sites, users } from '@/db/schema';
import { PLANS, type PlanId } from '@/lib/billing/plans';
import { recordCrawlRunsBulk } from '@/lib/sites/crawl-runs';
import { crawlSiteTask } from './crawl-site';

/**
 * Cron dispatcher. Runs at 03:00 UTC, selects every site whose owner is on a
 * plan with `limits.scheduledCrawl === 'daily'`, and fans the work out to the
 * `crawl-site` child task. That child task lives on a queue with
 * `concurrencyLimit: 3`, so even 100+ sites only put 3 crawls in flight
 * against the VPS at once — the rest wait in Trigger.dev's queue.
 *
 * Each child run carries an idempotency key of
 * `crawl:scheduled:{siteId}:{YYYY-MM-DD}`, so if this scheduled run retries
 * (or fires twice for any reason) duplicate site runs are deduped by
 * Trigger.dev before they reach the queue.
 */
export const dailyCrawlTask = schedules.task({
  id: 'daily-auto-crawl',
  cron: { pattern: '0 3 * * *', timezone: 'UTC' },
  maxDuration: 300,
  run: async (payload) => {
    const eligiblePlans: PlanId[] = (Object.keys(PLANS) as PlanId[]).filter(
      (id) => PLANS[id].limits.scheduledCrawl === 'daily'
    );

    const eligibleUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.plan, eligiblePlans));
    const eligibleUserIds = eligibleUsers.map((u) => u.id);

    if (eligibleUserIds.length === 0) {
      logger.log('No users on a scheduled-crawl plan');
      return { scheduledAt: payload.timestamp, dispatched: 0 };
    }

    const eligibleSites = await db
      .select({
        id: sites.id,
        userId: sites.userId,
        domain: sites.domain,
      })
      .from(sites)
      .innerJoin(users, eq(sites.userId, users.id))
      .where(inArray(sites.userId, eligibleUserIds));

    if (eligibleSites.length === 0) {
      return { scheduledAt: payload.timestamp, dispatched: 0 };
    }

    const isoDay = new Date(payload.timestamp).toISOString().slice(0, 10);

    // Build batch items with a per-site idempotency key. Two scheduled runs
    // on the same day (retry, manual replay) will not double-dispatch.
    const items = await Promise.all(
      eligibleSites.map(async (site) => ({
        payload: {
          siteId: site.id,
          userId: site.userId,
          domain: site.domain,
          kind: 'scheduled' as const,
        },
        options: {
          idempotencyKey: await idempotencyKeys.create(
            `crawl:scheduled:${site.id}:${isoDay}`
          ),
        },
      }))
    );

    const handle = await crawlSiteTask.batchTrigger(items);

    // Record the scheduled runs in our own table so the dashboard usage
    // cards and history reflect them. We don't count 'scheduled' rows
    // against any quota, so duplicate rows on retry are harmless.
    await recordCrawlRunsBulk(
      eligibleSites.map((site) => ({
        userId: site.userId,
        siteId: site.id,
        kind: 'scheduled' as const,
      }))
    );

    logger.log(`Enqueued ${items.length} site crawls`, { batchId: handle.batchId });

    return {
      scheduledAt: payload.timestamp,
      dispatched: items.length,
      batchId: handle.batchId,
    };
  },
});
