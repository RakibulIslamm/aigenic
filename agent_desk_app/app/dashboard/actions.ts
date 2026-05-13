'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { articles, conversations, sites } from '@/db/schema';
import { getOrCreateUser, requireUserId } from '@/lib/auth/user';
import {
  createSiteSchema,
  updateSiteSchema,
  DEFAULT_WIDGET_CONFIG,
} from '@/lib/sites/schemas';
import { startSiteCrawl, stopSiteCrawl, isScraperConfigured } from '@/lib/scraper/client';
import { getPlan } from '@/lib/billing/plans';
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

  // Fire-and-forget the crawl. We don't await the network call beyond the
  // initial accept response — webhooks update kbStatus as articles arrive.
  let scraperMessage: string | undefined;
  if (isScraperConfigured()) {
    try {
      await startSiteCrawl({
        siteId: site.id,
        domain: site.domain,
        maxPages: parsed.data.maxPages,
      });
      await db
        .update(sites)
        .set({ kbStatus: 'crawling' })
        .where(eq(sites.id, site.id));
    } catch (err) {
      await db
        .update(sites)
        .set({ kbStatus: 'failed' })
        .where(eq(sites.id, site.id));
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

  // Wipe existing articles so the next crawl reflects the current site.
  await db.delete(articles).where(eq(articles.siteId, siteId));

  await db
    .update(sites)
    .set({ kbStatus: 'crawling' })
    .where(eq(sites.id, siteId));

  try {
    await startSiteCrawl({ siteId, domain: site.domain });
  } catch (err) {
    await db
      .update(sites)
      .set({ kbStatus: 'failed' })
      .where(eq(sites.id, siteId));
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not reach scraper',
    };
  }

  revalidatePath(`/dashboard/sites/${siteId}`, 'layout');
  revalidatePath('/dashboard');
  return { ok: true, siteId, message: 'Re-crawl started' };
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

  // Phase 2: per-article re-scrape isn't supported by the worker yet — it
  // re-runs the full crawl, which will overwrite this article.
  await db
    .delete(articles)
    .where(and(eq(articles.id, articleId), eq(articles.siteId, siteId)));

  return rescrapeSiteAction(siteId);
}
