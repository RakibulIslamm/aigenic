import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The app ↔ scraper probe. The two deploy separately, so every way the other
 * side can disappoint — missing endpoint, garbage answer, network failure —
 * must come back as a reason the Settings card can phrase, never a throw.
 */

vi.mock('@/lib/env', () => ({
  env: {
    SCRAPER_API_URL: 'https://scraper.test',
    SCRAPER_API_KEY: 'k',
    appUrl: 'https://app.test',
  },
}));

const { probeSiteAccess, startSiteCrawl } = await import('@/lib/scraper/client');
const { isValidAccessKey } = await import('@/lib/sites/crawler-identity');

const KEY = 'a'.repeat(32);

function stubFetch(impl: () => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('probeSiteAccess', () => {
  it('returns a well-formed result', async () => {
    stubFetch(async () =>
      Response.json({ ok: false, code: 'blocked', status: 403, detail: 'HTTP 403' }),
    );
    expect(await probeSiteAccess('https://acme.com', KEY)).toEqual({
      ok: true,
      result: { ok: false, code: 'blocked', status: 403, detail: 'HTTP 403' },
    });
  });

  it('a 404 means the scraper predates /probe', async () => {
    stubFetch(async () => new Response('Not found', { status: 404 }));
    expect(await probeSiteAccess('https://acme.com', KEY)).toEqual({
      ok: false,
      reason: 'outdated',
    });
  });

  it.each([
    ['a 500', async () => new Response('boom', { status: 500 })],
    ['a network failure', async () => Promise.reject(new TypeError('fetch failed'))],
  ])('%s → unreachable', async (_label, impl) => {
    stubFetch(impl);
    expect(await probeSiteAccess('https://acme.com', KEY)).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it.each([
    ['non-JSON', async () => new Response('<html>proxy error</html>')],
    ['the wrong shape', async () => Response.json({ ok: 'maybe' })],
  ])('%s → invalid-response', async (_label, impl) => {
    stubFetch(impl);
    expect(await probeSiteAccess('https://acme.com', KEY)).toEqual({
      ok: false,
      reason: 'invalid-response',
    });
  });

  it('leaves out a malformed key rather than sending it', async () => {
    const fn = stubFetch(async () => Response.json({ ok: true, status: 200 }));
    await probeSiteAccess('https://acme.com', 'NOT HEX\r\n');
    const body = JSON.parse(
      String((fn.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body).toEqual({ url: 'https://acme.com' });
  });
});

describe('startSiteCrawl', () => {
  it('sends a valid key, and drops a malformed one', async () => {
    const fn = stubFetch(async () =>
      Response.json({ jobId: 'j', siteId: 's', status: 'queued' }),
    );
    const bodyOf = (i: number) =>
      JSON.parse(String((fn.mock.calls[i] as unknown as [string, RequestInit])[1].body));

    await startSiteCrawl({
      siteId: 's',
      domain: 'https://acme.com',
      generation: 1,
      accessKey: KEY,
    });
    await startSiteCrawl({
      siteId: 's',
      domain: 'https://acme.com',
      generation: 2,
      accessKey: 'bad',
    });

    expect(bodyOf(0).accessKey).toBe(KEY);
    expect(bodyOf(1)).not.toHaveProperty('accessKey');
  });
});

describe('isValidAccessKey', () => {
  it.each([
    [KEY, true],
    ['0123456789abcdef0123456789abcdef', true],
    ['A'.repeat(32), false],
    ['a'.repeat(31), false],
    [`${KEY}\n`, false],
    [null, false],
    [undefined, false],
  ])('%j → %s', (key, valid) => {
    expect(isValidAccessKey(key)).toBe(valid);
  });
});
