'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { runs } from '@trigger.dev/sdk/v3';
import { and, count, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { conversations, sites, type Site } from '@/db/schema';
import { getOrCreateUser, requireUserId } from '@/lib/auth/user';
import { isUuid } from '@/lib/ids';
import {
  createSiteSchema,
  updateSiteSchema,
  DEFAULT_WIDGET_CONFIG,
} from '@/lib/sites/schemas';
import { stopSiteCrawl } from '@/lib/scraper/client';
import { isScraperConfigured, isTriggerConfigured } from '@/lib/env';
import { ensureTriggerConfigured } from '@/lib/trigger/config';
import { getSiteForUser } from '@/lib/sites/queries';
import { enqueueSiteCrawl } from '@/lib/sites/enqueue-crawl';
import { getPlan, manualCrawlWindowStart } from '@/lib/billing/plans';
import { claimManualCrawlSlot, deleteCrawlRun } from '@/lib/sites/crawl-runs';
import { log } from '@/lib/log';

export type ActionState =
  | { ok: true; siteId?: string; message?: string }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string>;
      values?: Record<string, string>;
    };

/**
 * Loads the site via the request-memoized `getSiteForUser` and returns the
 * standard "Site not found" ActionState when it doesn't exist or belongs to
 * someone else. Collapses the ownership prologue every site action repeated.
 */
async function withSiteOwnership(
  siteId: string,
  userId: string,
  fn: (site: Site) => Promise<ActionState>,
): Promise<ActionState> {
  if (!isUuid(siteId)) {
    return { ok: false, error: 'Site not found' };
  }
  const site = await getSiteForUser(siteId, userId);
  if (!site) {
    return { ok: false, error: 'Site not found' };
  }
  return fn(site);
}

function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/**
 * Validates a FormData payload against a Zod schema and returns either the
 * parsed object or an ActionState with per-field errors.
 */
function parseForm<T>(
  schema: {
    safeParse: (data: unknown) => {
      success: boolean;
      data?: T;
      error?: { issues: Array<{ path: PropertyKey[]; message: string }> };
    };
  },
  formData: FormData,
): { ok: true; data: T } | { ok: false; fieldErrors: Record<string, string> } {
  const entries = Object.fromEntries(formData.entries());
  const result = schema.safeParse(entries);
  if (result.success && result.data) {
    return { ok: true, data: result.data };
  }
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error?.issues ?? []) {
    const key = String(issue.path[0] ?? 'form');
    fieldErrors[key] ??= issue.message;
  }
  return { ok: false, fieldErrors };
}

export async function createSiteAction(
  _prevState: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const user = await getOrCreateUser();

  const parsed = parseForm(createSiteSchema, formData);
  if (!parsed.ok) {
    return {
      ok: false,
      error: 'Please fix the highlighted fields',
      fieldErrors: parsed.fieldErrors,
      values: formValues(formData),
    };
  }

  // Enforce per-plan site limit on the server. The dashboard already disables
  // the button at the limit, but this guards against direct form posts. The
  // count and insert share a transaction holding a per-user advisory lock, so
  // two concurrent creates can't both see "under the cap" and both insert.
  const plan = getPlan(user.plan);
  const created = await db.transaction(
    async (tx): Promise<{ overCap: true } | { overCap: false; site?: Site }> => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id}))`);

      const [siteCountRow] = await tx
        .select({ value: count() })
        .from(sites)
        .where(eq(sites.userId, user.id));
      if ((siteCountRow?.value ?? 0) >= plan.limits.sites) {
        return { overCap: true };
      }

      const [site] = await tx
        .insert(sites)
        .values({
          userId: user.id,
          name: parsed.data.name,
          domain: parsed.data.domain,
          escalationEmail: parsed.data.escalationEmail,
          widgetConfig: { ...DEFAULT_WIDGET_CONFIG },
          kbStatus: 'pending',
          crawlStartedAt: new Date(),
        })
        .returning();
      return { overCap: false, site };
    },
  );

  if (created.overCap) {
    return {
      ok: false,
      error: `Your ${plan.name} plan is limited to ${plan.limits.sites} site${plan.limits.sites === 1 ? '' : 's'}. Upgrade to add more.`,
      values: formValues(formData),
    };
  }
  const site = created.site;
  if (!site) {
    return { ok: false, error: 'Could not create site' };
  }

  // Route the initial crawl through `enqueueSiteCrawl` (Trigger.dev queue,
  // synchronous fallback). No `crawl_runs` row is recorded — site creation
  // doesn't count against the manual-crawl quota. A dispatch failure isn't
  // fatal here: the site was created, so we surface the message instead —
  // but the site must land on `failed` (recoverable via Resync), not sit in
  // `pending` forever looking like a crawl that never comes.
  const enqueue = await enqueueSiteCrawl({
    siteId: site.id,
    userId: user.id,
    domain: site.domain,
    maxPages: parsed.data.maxPages,
  });
  if (!enqueue.ok) {
    await db
      .update(sites)
      .set({ kbStatus: 'failed' })
      .where(and(eq(sites.id, site.id), eq(sites.kbStatus, 'pending')));
  }

  revalidatePath('/dashboard');
  return {
    ok: true,
    siteId: site.id,
    message: enqueue.ok ? undefined : enqueue.error,
  };
}

export async function updateSiteAction(
  siteId: string,
  _prevState: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  if (!isUuid(siteId)) {
    return { ok: false, error: 'Site not found' };
  }

  const parsed = parseForm(updateSiteSchema, formData);
  if (!parsed.ok) {
    return {
      ok: false,
      error: 'Please fix the highlighted fields',
      fieldErrors: parsed.fieldErrors,
      values: formValues(formData),
    };
  }

  const result = await db
    .update(sites)
    .set({
      name: parsed.data.name,
      domain: parsed.data.domain,
      escalationEmail: parsed.data.escalationEmail,
      widgetConfig: {
        primaryColor: parsed.data.primaryColor,
        greeting: parsed.data.greeting,
        botName: parsed.data.botName,
      },
    })
    .where(and(eq(sites.id, siteId), eq(sites.userId, userId)))
    .returning({ id: sites.id });

  if (result.length === 0) {
    return { ok: false, error: 'Site not found' };
  }

  revalidatePath(`/dashboard/sites/${siteId}`, 'layout');
  revalidatePath('/dashboard');
  return { ok: true, siteId, message: 'Settings saved' };
}

export async function deleteSiteAction(siteId: string): Promise<void> {
  const userId = await requireUserId();

  // A malformed id can't match a row — skip the query and land the user back
  // on the list, same as a successful delete of an already-gone site.
  if (isUuid(siteId)) {
    // If a crawl is in flight, tell the VPS to stop before the row disappears
    // — otherwise it keeps crawling and hammers the webhook with 404s for a
    // site that no longer exists. Best-effort: the delete proceeds either way.
    const site = await getSiteForUser(siteId, userId);
    if (site && site.kbStatus === 'crawling' && isScraperConfigured()) {
      try {
        await stopSiteCrawl(siteId);
      } catch (err) {
        log.warn('could not stop crawl before site delete', { siteId, err });
      }
    }

    await db.delete(sites).where(and(eq(sites.id, siteId), eq(sites.userId, userId)));
  }

  revalidatePath('/dashboard');
  redirect('/dashboard');
}

export async function rescrapeSiteAction(siteId: string): Promise<ActionState> {
  const user = await getOrCreateUser();

  return withSiteOwnership(siteId, user.id, async (site) => {
    if (!isScraperConfigured()) {
      return {
        ok: false,
        error: 'Scraper service is not configured (SCRAPER_API_URL / SCRAPER_API_KEY).',
      };
    }

    // Reject up front if a crawl is already in progress (or queued). Without
    // this, we'd record a manual `crawl_runs` row and the task would skip with
    // `already-crawling` — the user would lose a quota slot for no work.
    // `pending` covers the window between "we enqueued the task" and "the
    // worker picked it up and flipped to crawling".
    if (site.kbStatus === 'crawling' || site.kbStatus === 'pending') {
      return {
        ok: false,
        error: 'A crawl is already in progress for this site.',
      };
    }

    // Enforce the per-plan manual-crawl quota (per user, rolling window) and
    // claim the slot in ONE locked transaction — a rapid double-click used to
    // be able to pass the count check twice before either insert landed.
    const plan = getPlan(user.plan);
    const claimId = await claimManualCrawlSlot({
      userId: user.id,
      siteId,
      since: manualCrawlWindowStart(plan),
      limit: plan.limits.manualCrawls.count,
    });
    if (!claimId) {
      const { count: max, period } = plan.limits.manualCrawls;
      return {
        ok: false,
        error: `You've used your ${max} manual re-crawl${max === 1 ? '' : 's'} for this ${period} on the ${plan.name} plan. ${plan.id === 'pro' ? 'Quota refills 24h after each crawl.' : 'Upgrade for more.'}`,
      };
    }

    // `optimisticPending` flips the status immediately on the queue path so
    // the dashboard reacts (banner, Stop button, SSE) instead of freezing
    // until the worker picks the job up. `crawlRunId` rides along so the
    // queued task can release the quota slot if it ends up skipping.
    const enqueue = await enqueueSiteCrawl({
      siteId,
      userId: user.id,
      domain: site.domain,
      optimisticPending: true,
      crawlRunId: claimId,
    });
    if (!enqueue.ok) {
      // Dispatch failed — release the quota slot so the user isn't punished
      // for our infra hiccup.
      await deleteCrawlRun(claimId);
      return {
        ok: false,
        error: `Could not enqueue crawl: ${enqueue.error}`,
      };
    }

    revalidatePath(`/dashboard/sites/${siteId}`, 'layout');
    revalidatePath('/dashboard');
    return { ok: true, siteId, message: 'Re-crawl queued' };
  });
}

export async function stopCrawlAction(siteId: string): Promise<ActionState> {
  const userId = await requireUserId();

  return withSiteOwnership(siteId, userId, async (site) => {
    // Queue-only stop: the task hasn't been picked up (status `pending`), so
    // there is nothing running on the VPS — cancel the queued Trigger run and
    // flip the status locally. Deliberately does NOT require the scraper env:
    // stopping a queue entry needs no scraper.
    if (site.kbStatus === 'pending') {
      if (site.pendingCrawlRunId && isTriggerConfigured()) {
        ensureTriggerConfigured();
        try {
          await runs.cancel(site.pendingCrawlRunId);
        } catch (err) {
          // Best-effort: the run may already be executing or finished. The
          // conditional flip below (and dispatch's atomic claim) still keeps
          // states coherent either way.
          log.warn('could not cancel queued crawl run', {
            siteId,
            runId: site.pendingCrawlRunId,
            err,
          });
        }
      }

      // Only flip if the worker STILL hasn't claimed the crawl — if it just
      // started (status now `crawling`), fall through to the real stop.
      const [flipped] = await db
        .update(sites)
        .set({
          // A site that has synced before still has its KB — it's `ready`.
          // One that never completed a crawl has nothing to serve: `failed`.
          kbStatus: site.kbLastSyncedAt ? 'ready' : 'failed',
          pendingCrawlRunId: null,
        })
        .where(and(eq(sites.id, siteId), eq(sites.kbStatus, 'pending')))
        .returning({ id: sites.id });

      if (flipped) {
        // The crawl never started, so it must not cost a quota slot —
        // deleting the claim row is the refund (the site's pointer clears
        // via ON DELETE SET NULL).
        if (site.activeCrawlRunId) {
          await deleteCrawlRun(site.activeCrawlRunId);
        }
        revalidatePath(`/dashboard/sites/${siteId}`, 'layout');
        revalidatePath('/dashboard');
        return { ok: true, siteId, message: 'Crawl cancelled' };
      }
    }

    if (!isScraperConfigured()) {
      return {
        ok: false,
        error: 'Scraper service is not configured (SCRAPER_API_URL / SCRAPER_API_KEY).',
      };
    }

    try {
      await stopSiteCrawl(siteId);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Could not reach scraper',
      };
    }

    // Optimistically flip status — the scraper will also send a `stopped`
    // webhook that hits the same state, but updating here makes the UI feel
    // instant. Partial articles are kept; the KB is still usable.
    await db
      .update(sites)
      .set({ kbStatus: 'ready', kbLastSyncedAt: new Date() })
      .where(eq(sites.id, siteId));

    revalidatePath(`/dashboard/sites/${siteId}`, 'layout');
    revalidatePath('/dashboard');
    return { ok: true, siteId, message: 'Crawl stopped' };
  });
}

export async function markConversationResolvedAction(
  siteId: string,
  conversationId: string,
): Promise<ActionState> {
  const userId = await requireUserId();

  if (!isUuid(conversationId)) {
    return { ok: false, error: 'Conversation not found' };
  }

  return withSiteOwnership(siteId, userId, async () => {
    const result = await db
      .update(conversations)
      .set({ status: 'resolved' })
      .where(and(eq(conversations.id, conversationId), eq(conversations.siteId, siteId)))
      .returning({ id: conversations.id });

    if (result.length === 0) {
      return { ok: false, error: 'Conversation not found' };
    }

    revalidatePath(`/dashboard/sites/${siteId}/conversations`, 'layout');
    return { ok: true, message: 'Marked as resolved' };
  });
}

export async function rescrapeArticleAction(
  siteId: string,
  articleId: string,
): Promise<ActionState> {
  const userId = await requireUserId();

  if (!isUuid(articleId)) {
    return { ok: false, error: 'Article not found' };
  }

  // Per-article re-scrape isn't supported by the worker yet — it re-runs the
  // full crawl, which wipes every article for the site anyway. Defer straight
  // to the full rescrape (which re-checks ownership via the request-memoized
  // getSiteForUser and enforces the manual-crawl quota); deleting this one
  // article first would just leave it gone if the quota check failed.
  return withSiteOwnership(siteId, userId, () => rescrapeSiteAction(siteId));
}
