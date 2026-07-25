import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The scraper webhook is the external contract with the VPS *and* the only
 * writer of `kbStatus` during a crawl. This exercises the auth gate, the Zod
 * payload contract, and the full event → status transition matrix — including
 * the `stopped` safety net, which only runs when the optimistic update from
 * the server action didn't land.
 *
 * The database is mocked: no Postgres, no network.
 */

const KEY = 'test-scraper-key'; // matches vitest.config.ts `test.env`

interface Recorded {
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
}
const recorded: Recorded = { inserts: [], updates: [] };
let siteRow: { id: string; kbStatus: string } | undefined;

vi.mock('@/db', () => ({
  db: {
    query: { sites: { findFirst: async () => siteRow } },
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        recorded.inserts.push(v);
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          recorded.updates.push(v);
        },
      }),
    }),
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
  recorded.updates = [];
  siteRow = { id: SITE_ID, kbStatus: 'pending' };
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
      },
    ]);
  });

  it('moves a pending site to crawling on the first article', async () => {
    siteRow = { id: SITE_ID, kbStatus: 'pending' };
    await post({ event: 'article', siteId: SITE_ID, article });
    expect(recorded.updates).toEqual([{ kbStatus: 'crawling' }]);
  });

  it('does not re-write the status once the site is already crawling', async () => {
    siteRow = { id: SITE_ID, kbStatus: 'crawling' };
    await post({ event: 'article', siteId: SITE_ID, article });
    expect(recorded.inserts).toHaveLength(1);
    expect(recorded.updates).toEqual([]);
  });
});

describe('kbStatus transition matrix', () => {
  it('complete → ready, and stamps the sync time', async () => {
    siteRow = { id: SITE_ID, kbStatus: 'crawling' };
    const res = await post({ event: 'complete', siteId: SITE_ID });
    expect(res.status).toBe(200);
    expect(recorded.updates).toHaveLength(1);
    expect(recorded.updates[0]!.kbStatus).toBe('ready');
    expect(recorded.updates[0]!.kbLastSyncedAt).toBeInstanceOf(Date);
  });

  it('stopped → ready, keeping the partial KB usable (the safety net)', async () => {
    siteRow = { id: SITE_ID, kbStatus: 'crawling' };
    const res = await post({ event: 'stopped', siteId: SITE_ID });
    expect(res.status).toBe(200);
    expect(recorded.updates).toHaveLength(1);
    expect(recorded.updates[0]!.kbStatus).toBe('ready');
    expect(recorded.updates[0]!.kbLastSyncedAt).toBeInstanceOf(Date);
  });

  it('error → failed, without stamping a sync time', async () => {
    siteRow = { id: SITE_ID, kbStatus: 'crawling' };
    const res = await post({ event: 'error', siteId: SITE_ID, error: 'boom' });
    expect(res.status).toBe(200);
    expect(recorded.updates).toEqual([{ kbStatus: 'failed' }]);
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
    siteRow = { id: SITE_ID, kbStatus: 'ready' };
    await post({ event: 'complete', siteId: SITE_ID });
    await post({ event: 'complete', siteId: SITE_ID });
    expect(recorded.updates.every((u) => u.kbStatus === 'ready')).toBe(true);
  });
});

describe('GET', () => {
  it('answers an unauthenticated health probe', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, endpoint: 'aigenic-scraper-webhook' });
  });
});
