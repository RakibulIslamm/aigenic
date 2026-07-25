import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The manual-rescrape quota. This is the abuse/cost boundary: the slot is
 * claimed *before* the crawl is enqueued (so a double-click can't race past
 * the count check) and released again if the dispatch fails (so an infra
 * hiccup doesn't burn the user's weekly allowance).
 *
 * Everything below the action is mocked — the point is the control flow, and
 * `enqueueSiteCrawl` (the Phase 6 seam) is what makes it reachable at all.
 */

/**
 * A real UUID, not `site-1`: the action shape-checks every id before it can
 * reach a `uuid` column, so a placeholder never gets past the guard.
 */
const SITE_ID = '11111111-1111-4111-8111-111111111111';

const site = {
  id: SITE_ID,
  userId: 'user-1',
  domain: 'https://acme.com',
  kbStatus: 'ready',
};

let user = { id: 'user-1', plan: 'free' as string };
let siteRow: typeof site | undefined = site;
let scraperConfigured = true;
let manualCrawlsUsed = 0;
let enqueueResult: { ok: true; via: 'trigger' } | { ok: false; error: string } = {
  ok: true,
  via: 'trigger',
};

/**
 * Mirrors the real claim's contract: over-quota returns null (no row
 * inserted), under-quota returns the claimed id. The count-vs-limit decision
 * itself now lives inside the locked transaction in `crawl-runs.ts`.
 */
const claimManualCrawlSlot = vi.fn(async ({ limit }: { limit: number }) =>
  manualCrawlsUsed >= limit ? null : 'claim-1',
);
const deleteCrawlRun = vi.fn(async () => {});
const enqueueSiteCrawl = vi.fn(async () => enqueueResult);

// `next/cache` is stubbed at the resolver level (see vitest.config.ts).
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/user', () => ({
  getOrCreateUser: async () => user,
  requireUserId: async () => user.id,
}));
vi.mock('@/lib/env', () => ({
  isScraperConfigured: () => scraperConfigured,
  isTriggerConfigured: () => true,
  env: {},
}));
vi.mock('@/lib/trigger/config', () => ({ ensureTriggerConfigured: () => {} }));
vi.mock('@trigger.dev/sdk/v3', () => ({
  runs: { cancel: vi.fn(async () => ({})) },
}));
vi.mock('@/lib/scraper/client', () => ({
  startSiteCrawl: async () => ({}),
  stopSiteCrawl: async () => ({ stopped: true }),
}));
vi.mock('@/lib/sites/queries', () => ({ getSiteForUser: async () => siteRow }));
vi.mock('@/lib/sites/enqueue-crawl', () => ({ enqueueSiteCrawl }));
vi.mock('@/lib/sites/crawl-runs', () => ({
  claimManualCrawlSlot,
  deleteCrawlRun,
}));

const { rescrapeSiteAction } = await import('@/app/dashboard/actions');

beforeEach(() => {
  vi.clearAllMocks();
  user = { id: 'user-1', plan: 'free' };
  siteRow = site;
  scraperConfigured = true;
  manualCrawlsUsed = 0;
  enqueueResult = { ok: true, via: 'trigger' };
});

describe('preconditions — no quota slot may be claimed', () => {
  it('refuses when the scraper is not configured', async () => {
    scraperConfigured = false;
    const res = await rescrapeSiteAction(SITE_ID);
    expect(res.ok).toBe(false);
    expect(claimManualCrawlSlot).not.toHaveBeenCalled();
    expect(enqueueSiteCrawl).not.toHaveBeenCalled();
  });

  it('refuses a malformed siteId before it can reach Postgres', async () => {
    // A non-uuid used to reach the `uuid` column and throw
    // `invalid input syntax for type uuid` — an uncaught 500, not an
    // ActionState. It must now stop at the action's own guard.
    const res = await rescrapeSiteAction('site-1');
    expect(res).toEqual({ ok: false, error: 'Site not found' });
    expect(claimManualCrawlSlot).not.toHaveBeenCalled();
    expect(enqueueSiteCrawl).not.toHaveBeenCalled();
  });

  it("refuses a site the user doesn't own", async () => {
    siteRow = undefined;
    const res = await rescrapeSiteAction(SITE_ID);
    expect(res).toEqual({ ok: false, error: 'Site not found' });
    expect(claimManualCrawlSlot).not.toHaveBeenCalled();
  });

  it.each(['crawling', 'pending'])('refuses while a crawl is %s', async (kbStatus) => {
    siteRow = { ...site, kbStatus };
    const res = await rescrapeSiteAction(SITE_ID);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/already in progress/i);
    // The whole point: an in-flight crawl must not cost a quota slot.
    expect(claimManualCrawlSlot).not.toHaveBeenCalled();
    expect(enqueueSiteCrawl).not.toHaveBeenCalled();
  });
});

describe('quota enforcement', () => {
  it('refuses once the free plan has used its 1 weekly re-crawl', async () => {
    manualCrawlsUsed = 1;
    const res = await rescrapeSiteAction(SITE_ID);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain('1 manual re-crawl for this week');
    // The claim IS the quota check now (count + insert under one lock): it
    // ran, returned null, and nothing was enqueued or rolled back.
    expect(claimManualCrawlSlot).toHaveBeenCalledTimes(1);
    expect(enqueueSiteCrawl).not.toHaveBeenCalled();
    expect(deleteCrawlRun).not.toHaveBeenCalled();
  });

  it('allows the pro plan 5 per day and refuses the 6th', async () => {
    user = { id: 'user-1', plan: 'pro' };

    manualCrawlsUsed = 4;
    expect((await rescrapeSiteAction(SITE_ID)).ok).toBe(true);

    manualCrawlsUsed = 5;
    const res = await rescrapeSiteAction(SITE_ID);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain('5 manual re-crawls for this day');
  });

  it('treats an unknown plan as free', async () => {
    user = { id: 'user-1', plan: 'enterprise' };
    manualCrawlsUsed = 1;
    expect((await rescrapeSiteAction(SITE_ID)).ok).toBe(false);
  });
});

describe('claim / rollback', () => {
  it('claims the slot before enqueuing, and keeps it when dispatch succeeds', async () => {
    const res = await rescrapeSiteAction(SITE_ID);

    expect(res).toEqual({ ok: true, siteId: SITE_ID, message: 'Re-crawl queued' });
    expect(claimManualCrawlSlot).toHaveBeenCalledWith({
      userId: 'user-1',
      siteId: SITE_ID,
      since: expect.any(Date),
      limit: 1,
    });
    expect(deleteCrawlRun).not.toHaveBeenCalled();

    // Ordering matters: claiming after dispatch would let a double-click
    // through while the first crawl is still being queued.
    expect(claimManualCrawlSlot.mock.invocationCallOrder[0]!).toBeLessThan(
      enqueueSiteCrawl.mock.invocationCallOrder[0]!,
    );
  });

  it('releases the slot when dispatch fails', async () => {
    enqueueResult = { ok: false, error: 'scraper unreachable' };

    const res = await rescrapeSiteAction(SITE_ID);

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe(
      'Could not enqueue crawl: scraper unreachable',
    );
    expect(claimManualCrawlSlot).toHaveBeenCalledTimes(1);
    // Rolled back with the id that was claimed — not a guess.
    expect(deleteCrawlRun).toHaveBeenCalledWith('claim-1');
  });

  it('asks for the optimistic pending flip so the dashboard reacts immediately', async () => {
    await rescrapeSiteAction(SITE_ID);
    expect(enqueueSiteCrawl).toHaveBeenCalledWith({
      siteId: SITE_ID,
      userId: 'user-1',
      domain: 'https://acme.com',
      optimisticPending: true,
      // The claim id travels with the task so a skipped run can refund it.
      crawlRunId: 'claim-1',
    });
  });
});
