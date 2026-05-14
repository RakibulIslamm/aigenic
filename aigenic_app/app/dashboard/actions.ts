'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { conversations, sites } from '@/db/schema';
import { getOrCreateUser, requireUserId } from '@/lib/auth/user';
import {
  createSiteSchema,
  updateSiteSchema,
  DEFAULT_WIDGET_CONFIG,
} from '@/lib/sites/schemas';
import { stopSiteCrawl, isScraperConfigured } from '@/lib/scraper/client';
import { dispatchSiteCrawl } from '@/lib/sites/dispatch';
import { getPlan, manualCrawlWindowStart } from '@/lib/billing/plans';
import {
  countManualCrawlsForUserSince,
  deleteCrawlRun,
  recordCrawlRun,
} from '@/lib/sites/crawl-runs';
import { crawlSiteTask } from '@/trigger/crawl-site';
import {
  ensureTriggerConfigured,
  isTriggerConfigured,
} from '@/lib/trigger/config';
import { count } from 'drizzle-orm';

export type ActionState =
  | { ok: true; siteId?: string; message?: string }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string>;
      values?: Record<string, string>;
    };

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
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } },
  formData: FormData
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
  formData: FormData
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
  // the button at the limit, but this guards against direct form posts.
  const plan = getPlan(user.plan);
  const [siteCountRow] = await db
    .select({ value: count() })
    .from(sites)
    .where(eq(sites.userId, user.id));
  if ((siteCountRow?.value ?? 0) >= plan.limits.sites) {
    return {
      ok: false,
      error: `Your ${plan.name} plan is limited to ${plan.limits.sites} site${plan.limits.sites === 1 ? '' : 's'}. Upgrade to add more.`,
      values: formValues(formData),
    };
  }

  const [site] = await db
    .insert(sites)
    .values({
      userId: user.id,
      name: parsed.data.name,
      domain: parsed.data.domain,
      escalationEmail: parsed.data.escalationEmail,
      widgetConfig: { ...DEFAULT_WIDGET_CONFIG },
      kbStatus: 'pending',
    })
    .returning();

  if (!site) {
    return { ok: false, error: 'Could not create site' };
  }

  // Route the initial crawl through the Trigger.dev queue (same as a manual
  // re-sync) so it respects `scraper-dispatch`'s `concurrencyLimit: 3` and
  // shows up in the cloud.trigger.dev dashboard alongside every other crawl.
  // No `crawl_runs` row is recorded — site creation doesn't count against
  // the manual-crawl quota. Falls back to a synchronous dispatch when
  // Trigger.dev isn't configured (local dev without TRIGGER_API_KEY).
  let scraperMessage: string | undefined;
  if (isTriggerConfigured()) {
    ensureTriggerConfigured();
    try {
      await crawlSiteTask.trigger({
        siteId: site.id,
        userId: user.id,
        domain: site.domain,
        kind: 'manual',
        maxPages: parsed.data.maxPages,
      });
    } catch (err) {
      scraperMessage =
        err instanceof Error ? err.message : 'Could not enqueue crawl';
    }
  } else if (isScraperConfigured()) {
    try {
      await dispatchSiteCrawl({
        siteId: site.id,
        domain: site.domain,
        maxPages: parsed.data.maxPages,
      });
    } catch (err) {
      scraperMessage =
        err instanceof Error ? err.message : 'Could not reach scraper';
    }
  } else {
    scraperMessage =
      'Scraper service is not configured. Set SCRAPER_API_URL and SCRAPER_API_KEY to enable automatic crawls.';
  }

  revalidatePath('/dashboard');
  return { ok: true, siteId: site.id, message: scraperMessage };
}

export async function updateSiteAction(
  siteId: string,
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const userId = await requireUserId();

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

  await db
    .delete(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, userId)));

  revalidatePath('/dashboard');
  redirect('/dashboard');
}

export async function rescrapeSiteAction(siteId: string): Promise<ActionState> {
  const user = await getOrCreateUser();

  const site = await db.query.sites.findFirst({
    where: and(eq(sites.id, siteId), eq(sites.userId, user.id)),
  });
  if (!site) {
    return { ok: false, error: 'Site not found' };
  }

  if (!isScraperConfigured()) {
    return {
      ok: false,
      error: 'Scraper service is not configured (SCRAPER_API_URL / SCRAPER_API_KEY).',
    };
  }

  // Reject up front if a crawl is already in progress. Without this, we'd
  // record a manual `crawl_runs` row and the task would skip with
  // `already-crawling` — the user would lose a quota slot for no work.
  if (site.kbStatus === 'crawling') {
    return {
      ok: false,
      error: 'A crawl is already in progress for this site.',
    };
  }

  // Enforce the per-plan manual-crawl quota (per user, rolling window).
  // The dashboard hides the button when at the cap, but a direct form post
  // would otherwise bypass it.
  const plan = getPlan(user.plan);
  const used = await countManualCrawlsForUserSince(
    user.id,
    manualCrawlWindowStart(plan)
  );
  if (used >= plan.limits.manualCrawls.count) {
    const { count: max, period } = plan.limits.manualCrawls;
    return {
      ok: false,
      error: `You've used your ${max} manual re-crawl${max === 1 ? '' : 's'} for this ${period} on the ${plan.name} plan. ${plan.id === 'pro' ? 'Quota refills 24h after each crawl.' : 'Upgrade for more.'}`,
    };
  }

  // Claim a quota slot synchronously *before* triggering the task, so a
  // rapid double-click can't sneak past the count check while the task is
  // still queued.
  const claimId = await recordCrawlRun({
    userId: user.id,
    siteId,
    kind: 'manual',
  });

  // Prefer the Trigger.dev queue (concurrencyLimit: 3) so the VPS never sees
  // more than 3 concurrent dispatches regardless of origin. Fall back to a
  // synchronous dispatch in environments that haven't wired up Trigger.dev
  // (local dev without TRIGGER_API_KEY).
  try {
    if (isTriggerConfigured()) {
      ensureTriggerConfigured();
      await crawlSiteTask.trigger({
        siteId,
        userId: user.id,
        domain: site.domain,
        kind: 'manual',
      });
    } else {
      await dispatchSiteCrawl({ siteId, domain: site.domain });
    }
  } catch (err) {
    // Dispatch failed — release the quota slot so the user isn't punished
    // for our infra hiccup.
    await deleteCrawlRun(claimId);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not enqueue crawl: ${err.message}`
          : 'Could not enqueue crawl',
    };
  }

  revalidatePath(`/dashboard/sites/${siteId}`, 'layout');
  revalidatePath('/dashboard');
  return { ok: true, siteId, message: 'Re-crawl queued' };
}

export async function stopCrawlAction(siteId: string): Promise<ActionState> {
  const userId = await requireUserId();

  const site = await db.query.sites.findFirst({
    where: and(eq(sites.id, siteId), eq(sites.userId, userId)),
  });
  if (!site) {
    return { ok: false, error: 'Site not found' };
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
}

export async function markConversationResolvedAction(
  siteId: string,
  conversationId: string
): Promise<ActionState> {
  const userId = await requireUserId();

  const site = await db.query.sites.findFirst({
    where: and(eq(sites.id, siteId), eq(sites.userId, userId)),
  });
  if (!site) return { ok: false, error: 'Site not found' };

  const result = await db
    .update(conversations)
    .set({ status: 'resolved' })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.siteId, siteId)
      )
    )
    .returning({ id: conversations.id });

  if (result.length === 0) {
    return { ok: false, error: 'Conversation not found' };
  }

  revalidatePath(`/dashboard/sites/${siteId}/conversations`, 'layout');
  return { ok: true, message: 'Marked as resolved' };
}

export async function rescrapeArticleAction(
  siteId: string,
  articleId: string
): Promise<ActionState> {
  const userId = await requireUserId();

  const site = await db.query.sites.findFirst({
    where: and(eq(sites.id, siteId), eq(sites.userId, userId)),
  });
  if (!site) {
    return { ok: false, error: 'Site not found' };
  }

  // Per-article re-scrape isn't supported by the worker yet — it re-runs the
  // full crawl, which wipes every article for the site anyway. Defer straight
  // to the full rescrape (which enforces the manual-crawl quota); deleting
  // this one article first would just leave it gone if the quota check failed.
  void articleId;
  return rescrapeSiteAction(siteId);
}
