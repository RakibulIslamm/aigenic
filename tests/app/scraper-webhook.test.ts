import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The scraper webhook is the external contract with the VPS, the only writer of
 * `kbStatus` during a crawl, and — since crawl generations landed — the only
 * code that can promote or discard a knowledge base. This exercises the auth
 * gate, the Zod payload contract, the full event → status matrix, and the
 * generation swap.
 *
 * The database is mocked: no Postgres, no network. The swap's *decision* is
 * covered exhaustively in `generations.test.ts`; what matters here is that this
 * route feeds it the right inputs and applies the result to the right rows.
 */

const KEY = 'test-scraper-key'; // matches vitest.config.ts `test.env`

interface Recorded {
  inserts: Record<string, unknown>[];
  /** `onConflictDoUpdate` configs, one per upsert. */
  upserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
  /** Article deletions — the destructive half of the swap. */
  deletes: number;
  /** How many statements ran inside a `db.transaction`. */
  inTransaction: number;
}
const recorded: Recorded = {
  inserts: [],
  upserts: [],
  updates: [],
  deletes: 0,
  inTransaction: 0,
};

interface SiteRow {
  id: string;
  kbStatus: string;
  activeGeneration: number;
  crawlGeneration: number;
}
let siteRow: SiteRow | undefined;
/** Article counts per generation, as `countByGeneration` would return them. */
let counts: Record<number, number> = {};

let insideTransaction = false;

const writer = {
  insert: () => ({
    values: (v: Record<string, unknown>) => {
      recorded.inserts.push(v);
      if (insideTransaction) recorded.inTransaction++;
      return {
        onConflictDoUpdate: async (cfg: Record<string, unknown>) => {
          recorded.upserts.push(cfg);
        },
      };
    },
  }),
  update: () => ({
    set: (v: Record<string, unknown>) => ({
      where: async () => {
        recorded.updates.push(v);
        if (insideTransaction) recorded.inTransaction++;
      },
    }),
  }),
  delete: () => ({
    where: async () => {
      recorded.deletes++;
      if (insideTransaction) recorded.inTransaction++;
    },
  }),
};

vi.mock('@/db', () => ({
  db: {
    query: { sites: { findFirst: async () => siteRow } },
    ...writer,
    select: () => ({
      from: () => ({
        where: () => ({
          groupBy: async () =>
            Object.entries(counts).map(([generation, value]) => ({
              generation: Number(generation),
              value,
            })),
        }),
      }),
    }),
    transaction: async (fn: (tx: typeof writer) => Promise<void>) => {
      insideTransaction = true;
      try {
        await fn(writer);
      } finally {
        insideTransaction = false;
      }
    },
  },
}));

const { POST, GET } = await import('@/app/api/scraper/webhook/route');

const SITE_ID = '3f1a5c8e-9b2d-4a7e-8c1f-2d6b4e9a0c37';

function post(body: unknown, key: string | null = KEY) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key !== null) headers['x-api-key'] = key;
  return POST(
    new Request('http://localhost/api/scraper/webhook', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }) as never,
  );
}

beforeEach(() => {
  recorded.inserts = [];
  recorded.upserts = [];
  recorded.updates = [];
  recorded.deletes = 0;
  recorded.inTransaction = 0;
  siteRow = { id: SITE_ID, kbStatus: 'pending', activeGeneration: 0, crawlGeneration: 0 };
  counts = {};
});

describe('auth', () => {
  it('rejects a request with no API key', async () => {
    const res = await post({ event: 'complete', siteId: SITE_ID }, null);
    expect(res.status).toBe(401);
    expect(recorded.updates).toEqual([]);
  });

  it('rejects a wrong API key', async () => {
    const res = await post({ event: 'complete', siteId: SITE_ID }, 'nope');
    expect(res.status).toBe(401);
    expect(recorded.updates).toEqual([]);
  });

  it('checks auth before touching the database', async () => {
    // A malformed body with a bad key must still 401, never 400 — otherwise the
    // endpoint leaks whether a payload shape is valid to unauthenticated callers.
    const res = await post({ garbage: true }, 'nope');
    expect(res.status).toBe(401);
  });
});

describe('payload contract', () => {
  it('rejects a body that is not JSON', async () => {
    const res = await post('{ not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON' });
  });

  it('rejects an unknown event name', async () => {
    expect((await post({ event: 'progress', siteId: SITE_ID })).status).toBe(400);
  });

  it('rejects a non-uuid siteId', async () => {
    expect((await post({ event: 'complete', siteId: 'site-1' })).status).toBe(400);
  });

  it('rejects an article missing required fields', async () => {
    expect(
      (await post({ event: 'article', siteId: SITE_ID, article: { title: 'x' } })).status,
    ).toBe(400);
    expect(
      (
        await post({
          event: 'article',
          siteId: SITE_ID,
          article: { title: '', content: 'body' },
        })
      ).status,
    ).toBe(400);
  });

  it('rejects an article whose content exceeds the size cap', async () => {
    const article = { title: 'ok', content: 'a'.repeat(200_001) };
    expect((await post({ event: 'article', siteId: SITE_ID, article })).status).toBe(400);
  });

  it('rejects a non-url sourceUrl but allows it to be omitted', async () => {
    const base = { title: 'ok', content: 'body' };
    expect(
      (
        await post({
          event: 'article',
          siteId: SITE_ID,
          article: { ...base, sourceUrl: 'not-a-url' },
        })
      ).status,
    ).toBe(400);
    expect(
      (await post({ event: 'article', siteId: SITE_ID, article: base })).status,
    ).toBe(200);
  });

  it('rejects a negative or non-integer generation', async () => {
    for (const generation of [-1, 1.5, 'two']) {
      expect(
        (await post({ event: 'complete', siteId: SITE_ID, generation })).status,
        String(generation),
      ).toBe(400);
    }
  });

  it('404s an event for a site that does not exist', async () => {
    siteRow = undefined;
    const res = await post({ event: 'complete', siteId: SITE_ID });
    expect(res.status).toBe(404);
    expect(recorded.updates).toEqual([]);
  });
});

describe('article events', () => {
  const article = { title: 'Pricing', content: 'Plans and pricing.' };

  it('stores the article and normalizes a missing sourceUrl to null', async () => {
    const res = await post({ event: 'article', siteId: SITE_ID, article });
    expect(res.status).toBe(200);
    expect(recorded.inserts).toEqual([
      {
        siteId: SITE_ID,
        title: 'Pricing',
        content: 'Plans and pricing.',
        sourceUrl: null,
        crawlGeneration: 0,
      },
    ]);
  });

  it('files the row under the crawl generation, not the served one', async () => {
    // This is what keeps the live KB readable while a re-crawl streams in.
    siteRow = {
      id: SITE_ID,
      kbStatus: 'crawling',
      activeGeneration: 3,
      crawlGeneration: 4,
    };
    await post({ event: 'article', siteId: SITE_ID, generation: 4, article });
    expect(recorded.inserts[0]!.crawlGeneration).toBe(4);
  });

  it('upserts on (site, generation, url) so a redelivery cannot duplicate', async () => {
    await post({
      event: 'article',
      siteId: SITE_ID,
      article: { ...article, sourceUrl: 'https://acme.com/pricing' },
    });
    expect(recorded.upserts).toHaveLength(1);
    expect(recorded.upserts[0]!.set).toEqual({
      title: 'Pricing',
      content: 'Plans and pricing.',
    });
  });

  it('writes the row and the status promotion in one transaction', async () => {
    siteRow = {
      id: SITE_ID,
      kbStatus: 'pending',
      activeGeneration: 0,
      crawlGeneration: 0,
    };
    await post({ event: 'article', siteId: SITE_ID, article });
    expect(recorded.inTransaction).toBe(2);
  });

  it('drops an article from a superseded crawl', async () => {
    siteRow = {
      id: SITE_ID,
      kbStatus: 'crawling',
      activeGeneration: 3,
      crawlGeneration: 5,
    };
    const res = await post({ event: 'article', siteId: SITE_ID, generation: 4, article });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: 'superseded' });
    expect(recorded.inserts).toEqual([]);
  });

  it('treats a missing generation as the crawl in flight (old scraper build)', async () => {
    // The app and the VPS deploy independently; during that window events
    // arrive without a generation and must still be ingested.
    siteRow = {
      id: SITE_ID,
      kbStatus: 'crawling',
      activeGeneration: 3,
      crawlGeneration: 4,
    };
    await post({ event: 'article', siteId: SITE_ID, article });
    expect(recorded.inserts[0]!.crawlGeneration).toBe(4);
  });

  it('moves a pending site to crawling on the first article', async () => {
    siteRow = {
      id: SITE_ID,
      kbStatus: 'pending',
      activeGeneration: 0,
      crawlGeneration: 0,
    };
    await post({ event: 'article', siteId: SITE_ID, article });
    expect(recorded.updates).toEqual([{ kbStatus: 'crawling' }]);
  });

  it('does not re-write the status once the site is already crawling', async () => {
    siteRow = {
      id: SITE_ID,
      kbStatus: 'crawling',
      activeGeneration: 0,
      crawlGeneration: 0,
    };
    await post({ event: 'article', siteId: SITE_ID, article });
    expect(recorded.inserts).toHaveLength(1);
    expect(recorded.updates).toEqual([]);
  });

  it('never drags a finished site back to crawling', async () => {
    // A late webhook used to promote from *any* status, which left a ready site
    // spinning on `crawling` forever.
    siteRow = { id: SITE_ID, kbStatus: 'ready', activeGeneration: 0, crawlGeneration: 0 };
    await post({ event: 'article', siteId: SITE_ID, article });
    expect(recorded.updates).toEqual([]);
  });
});

describe('the generation swap', () => {
  const crawling = (over: Partial<SiteRow> = {}): SiteRow => ({
    id: SITE_ID,
    kbStatus: 'crawling',
    activeGeneration: 3,
    crawlGeneration: 4,
    ...over,
  });

  it('promotes the crawled generation and deletes the rest', async () => {
    siteRow = crawling();
    counts = { 3: 100, 4: 120 };
    const res = await post({ event: 'complete', siteId: SITE_ID, generation: 4 });
    expect(res.status).toBe(200);
    expect(recorded.updates).toEqual([
      {
        activeGeneration: 4,
        kbStatus: 'ready',
        kbLastSyncedAt: expect.any(Date),
        // Success wipes any stale failure explanation.
        kbLastError: null,
        kbLastErrorCode: null,
      },
    ]);
    expect(recorded.deletes).toBe(1);
    // Both halves in one transaction: a crash between them would either serve a
    // generation about to be deleted, or delete the one still being served.
    expect(recorded.inTransaction).toBe(2);
  });

  it('refuses to promote a crawl that indexed nothing, and marks it failed', async () => {
    siteRow = crawling();
    counts = { 3: 100 }; // generation 4 produced no rows at all
    const res = await post({ event: 'complete', siteId: SITE_ID, generation: 4 });
    expect(await res.json()).toEqual({ ok: true, kept: 'empty-crawl' });
    expect(recorded.updates).toEqual([
      {
        kbStatus: 'failed',
        kbLastError: expect.stringContaining('without indexing any pages'),
        kbLastErrorCode: 'empty',
      },
    ]);
    // The live KB is untouched — no promotion, and above all no delete.
    expect(recorded.deletes).toBe(0);
  });

  it('keeps the KB ready when a stopped crawl indexed nothing', async () => {
    siteRow = crawling();
    counts = { 3: 100 };
    await post({ event: 'stopped', siteId: SITE_ID, generation: 4 });
    expect(recorded.updates).toEqual([{ kbStatus: 'ready' }]);
    expect(recorded.deletes).toBe(0);
  });

  it('promotes a partial crawl the user stopped', async () => {
    siteRow = crawling();
    counts = { 3: 100, 4: 7 };
    await post({ event: 'stopped', siteId: SITE_ID, generation: 4 });
    expect(recorded.updates[0]!.activeGeneration).toBe(4);
    expect(recorded.deletes).toBe(1);
  });

  it('ignores a terminal event from a superseded crawl', async () => {
    siteRow = crawling({ crawlGeneration: 5 });
    counts = { 3: 100, 4: 40 };
    for (const event of ['complete', 'stopped'] as const) {
      const res = await post({ event, siteId: SITE_ID, generation: 4 });
      expect(await res.json(), event).toEqual({ ok: true, ignored: 'superseded' });
    }
    expect(recorded.updates).toEqual([]);
    expect(recorded.deletes).toBe(0);
  });

  it('marks an empty FIRST crawl failed — no green badge over an empty KB', async () => {
    // The ghorerbazar case: Cloudflare 403s every page, the crawl "completes"
    // with zero articles, and this used to promote → "ready" with nothing in
    // it. Now it's an honest failure the dashboard can explain.
    siteRow = crawling({ activeGeneration: 0, crawlGeneration: 1 });
    counts = {}; // nothing anywhere: a brand-new site whose crawl found nothing
    const res = await post({ event: 'complete', siteId: SITE_ID, generation: 1 });
    expect(await res.json()).toEqual({ ok: true, kept: 'empty-crawl' });
    expect(recorded.updates[0]!.kbStatus).toBe('failed');
    expect(recorded.updates[0]).not.toHaveProperty('activeGeneration');
    expect(recorded.deletes).toBe(0);
  });
});

describe('kbStatus transition matrix', () => {
  it('complete → ready, and stamps the sync time', async () => {
    siteRow = {
      id: SITE_ID,
      kbStatus: 'crawling',
      activeGeneration: 0,
      crawlGeneration: 0,
    };
    counts = { 0: 5 }; // the crawl indexed pages — an empty complete is a failure now
    const res = await post({ event: 'complete', siteId: SITE_ID });
    expect(res.status).toBe(200);
    expect(recorded.updates).toHaveLength(1);
    expect(recorded.updates[0]!.kbStatus).toBe('ready');
    expect(recorded.updates[0]!.kbLastSyncedAt).toBeInstanceOf(Date);
  });

  it('stopped → ready, keeping the partial KB usable (the safety net)', async () => {
    siteRow = {
      id: SITE_ID,
      kbStatus: 'crawling',
      activeGeneration: 0,
      crawlGeneration: 0,
    };
    counts = { 0: 5 };
    const res = await post({ event: 'stopped', siteId: SITE_ID });
    expect(res.status).toBe(200);
    expect(recorded.updates).toHaveLength(1);
    expect(recorded.updates[0]!.kbStatus).toBe('ready');
    expect(recorded.updates[0]!.kbLastSyncedAt).toBeInstanceOf(Date);
  });

  it('error → failed, storing the reason without stamping a sync time', async () => {
    siteRow = {
      id: SITE_ID,
      kbStatus: 'crawling',
      activeGeneration: 0,
      crawlGeneration: 0,
    };
    const res = await post({ event: 'error', siteId: SITE_ID, error: 'boom' });
    expect(res.status).toBe(200);
    expect(recorded.updates).toEqual([
      { kbStatus: 'failed', kbLastError: 'boom', kbLastErrorCode: null },
    ]);
  });

  it('error stores the failure classification for the dashboard', async () => {
    siteRow = {
      id: SITE_ID,
      kbStatus: 'crawling',
      activeGeneration: 0,
      crawlGeneration: 0,
    };
    await post({
      event: 'error',
      siteId: SITE_ID,
      error: 'A firewall is blocking our crawler.',
      code: 'blocked',
    });
    expect(recorded.updates).toEqual([
      {
        kbStatus: 'failed',
        kbLastError: 'A firewall is blocking our crawler.',
        kbLastErrorCode: 'blocked',
      },
    ]);
  });

  it('error keeps the served KB and discards only the staging rows', async () => {
    // The whole point of generations: a crawl that dies costs you nothing.
    siteRow = {
      id: SITE_ID,
      kbStatus: 'crawling',
      activeGeneration: 3,
      crawlGeneration: 4,
    };
    await post({ event: 'error', siteId: SITE_ID, generation: 4, error: 'boom' });
    expect(recorded.updates).toEqual([
      { kbStatus: 'failed', kbLastError: 'boom', kbLastErrorCode: null },
    ]);
    expect(recorded.updates[0]).not.toHaveProperty('activeGeneration');
    expect(recorded.deletes).toBe(1);
    expect(recorded.inTransaction).toBe(2);
  });

  it('ignores an error from a superseded crawl', async () => {
    // Otherwise a dead crawl's error marks a site that has since recrawled as failed.
    siteRow = { id: SITE_ID, kbStatus: 'ready', activeGeneration: 4, crawlGeneration: 5 };
    const res = await post({
      event: 'error',
      siteId: SITE_ID,
      generation: 4,
      error: 'boom',
    });
    expect(await res.json()).toEqual({ ok: true, ignored: 'superseded' });
    expect(recorded.updates).toEqual([]);
    expect(recorded.deletes).toBe(0);
  });

  it('accepts the optional fields the scraper may attach', async () => {
    expect(
      (await post({ event: 'complete', siteId: SITE_ID, totalPages: 12 })).status,
    ).toBe(200);
    expect(
      (await post({ event: 'stopped', siteId: SITE_ID, totalPages: 3 })).status,
    ).toBe(200);
    expect((await post({ event: 'error', siteId: SITE_ID })).status).toBe(200);
  });

  it('is idempotent for repeated terminal events', async () => {
    siteRow = { id: SITE_ID, kbStatus: 'ready', activeGeneration: 2, crawlGeneration: 2 };
    counts = { 2: 50 };
    await post({ event: 'complete', siteId: SITE_ID, generation: 2 });
    await post({ event: 'complete', siteId: SITE_ID, generation: 2 });
    expect(recorded.updates.every((u) => u.kbStatus === 'ready')).toBe(true);
    expect(recorded.updates.every((u) => u.activeGeneration === 2)).toBe(true);
  });
});

describe('GET', () => {
  it('answers an unauthenticated health probe', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, endpoint: 'aigenic-scraper-webhook' });
  });
});
