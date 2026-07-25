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

const site = {
  id: 'site-1',
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

const recordCrawlRun = vi.fn(async () => 'claim-1');
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
vi.mock('@/lib/scraper/client', () => ({
  startSiteCrawl: async () => ({}),
  stopSiteCrawl: async () => ({ stopped: true }),
}));
vi.mock('@/lib/sites/queries', () => ({ getSiteForUser: async () => siteRow }));
vi.mock('@/lib/sites/enqueue-crawl', () => ({ enqueueSiteCrawl }));
vi.mock('@/lib/sites/crawl-runs', () => ({
  countManualCrawlsForUserSince: async () => manualCrawlsUsed,
  recordCrawlRun,
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
    const res = await rescrapeSiteAction('site-1');
    expect(res.ok).toBe(false);
    expect(recordCrawlRun).not.toHaveBeenCalled();
    expect(enqueueSiteCrawl).not.toHaveBeenCalled();
  });

  it("refuses a site the user doesn't own", async () => {
    siteRow = undefined;
    const res = await rescrapeSiteAction('site-1');
    expect(res).toEqual({ ok: false, error: 'Site not found' });
    expect(recordCrawlRun).not.toHaveBeenCalled();
  });

  it.each(['crawling', 'pending'])('refuses while a crawl is %s', async (kbStatus) => {
    siteRow = { ...site, kbStatus };
    const res = await rescrapeSiteAction('site-1');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/already in progress/i);
    // The whole point: an in-flight crawl must not cost a quota slot.
    expect(recordCrawlRun).not.toHaveBeenCalled();
    expect(enqueueSiteCrawl).not.toHaveBeenCalled();
  });
});

describe('quota enforcement', () => {
  it('refuses once the free plan has used its 1 weekly re-crawl', async () => {
    manualCrawlsUsed = 1;
    const res = await rescrapeSiteAction('site-1');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain('1 manual re-crawl for this week');
    expect(recordCrawlRun).not.toHaveBeenCalled();
  });

  it('allows the pro plan 5 per day and refuses the 6th', async () => {
    user = { id: 'user-1', plan: 'pro' };

    manualCrawlsUsed = 4;
    expect((await rescrapeSiteAction('site-1')).ok).toBe(true);

    manualCrawlsUsed = 5;
    const res = await rescrapeSiteAction('site-1');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain('5 manual re-crawls for this day');
  });

  it('treats an unknown plan as free', async () => {
    user = { id: 'user-1', plan: 'enterprise' };
    manualCrawlsUsed = 1;
    expect((await rescrapeSiteAction('site-1')).ok).toBe(false);
  });
});

describe('claim / rollback', () => {
  it('claims the slot before enqueuing, and keeps it when dispatch succeeds', async () => {
    const res = await rescrapeSiteAction('site-1');

    expect(res).toEqual({ ok: true, siteId: 'site-1', message: 'Re-crawl queued' });
    expect(recordCrawlRun).toHaveBeenCalledWith({
      userId: 'user-1',
      siteId: 'site-1',
      kind: 'manual',
    });
    expect(deleteCrawlRun).not.toHaveBeenCalled();

    // Ordering matters: claiming after dispatch would let a double-click
    // through while the first crawl is still being queued.
    expect(recordCrawlRun.mock.invocationCallOrder[0]!).toBeLessThan(
      enqueueSiteCrawl.mock.invocationCallOrder[0]!,
    );
  });

  it('releases the slot when dispatch fails', async () => {
    enqueueResult = { ok: false, error: 'scraper unreachable' };

    const res = await rescrapeSiteAction('site-1');

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe(
      'Could not enqueue crawl: scraper unreachable',
    );
    expect(recordCrawlRun).toHaveBeenCalledTimes(1);
    // Rolled back with the id that was claimed — not a guess.
    expect(deleteCrawlRun).toHaveBeenCalledWith('claim-1');
  });

  it('asks for the optimistic pending flip so the dashboard reacts immediately', async () => {
    await rescrapeSiteAction('site-1');
    expect(enqueueSiteCrawl).toHaveBeenCalledWith({
      siteId: 'site-1',
      userId: 'user-1',
      domain: 'https://acme.com',
      optimisticPending: true,
    });
  });
});
