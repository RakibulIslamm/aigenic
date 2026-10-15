import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCESS_KEY_HEADER,
  CRAWLER_UA_TOKEN,
  createCrawlIdentity,
  crawlFetch,
} from '../../vps-scraper/src/identity.js';

/**
 * The access key is a firewall bypass for one owner's site. These pin down the
 * one property that makes handing it to us safe: it only ever reaches that
 * site — never a third-party host a sitemap lists or a redirect lands on.
 */

const KEY = 'a'.repeat(32);
const site = { hostname: 'example.com' };

describe('createCrawlIdentity', () => {
  const identity = createCrawlIdentity({ site, accessKey: KEY });

  it('identifies as AigenicBot by default', () => {
    expect(identity.userAgent).toContain(`${CRAWLER_UA_TOKEN}/`);
    expect(identity.headersFor('https://example.com/')['User-Agent']).toBe(
      identity.userAgent,
    );
  });

  it('honors a User-Agent override, and treats empty as unset', () => {
    expect(createCrawlIdentity({ site, userAgent: 'Custom/1.0' }).userAgent).toBe(
      'Custom/1.0',
    );
    expect(createCrawlIdentity({ site, userAgent: '' }).userAgent).toContain(
      CRAWLER_UA_TOKEN,
    );
  });

  it.each(['https://example.com/pricing', 'http://www.example.com/a?b=1'])(
    'sends the key to the site itself: %s',
    (url) => {
      expect(identity.headersFor(url)[ACCESS_KEY_HEADER]).toBe(KEY);
    },
  );

  it.each([
    'https://cdn.example.net/sitemap.xml',
    'https://blog.example.com/post', // a subdomain is a different site
    'https://example.com.evil.test/',
    'ftp://example.com/file',
    'not a url',
  ])('never sends the key elsewhere: %s', (url) => {
    expect(identity.headersFor(url)).not.toHaveProperty(ACCESS_KEY_HEADER);
    expect(identity.carriesKey(url)).toBe(false);
  });

  it('sends no key header at all when the site has none', () => {
    const anonymous = createCrawlIdentity({ site });
    expect(anonymous.headersFor('https://example.com/')).toEqual({
      'User-Agent': anonymous.userAgent,
    });
  });
});

describe('crawlFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Stubs `fetch` with a scripted redirect chain and records what each hop sent. */
  function stubChain(chain: Record<string, { status: number; location?: string }>) {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
        seen.push({ url, headers: init.headers });
        const hop = chain[url] ?? { status: 200 };
        return new Response(hop.status === 200 ? 'ok' : null, {
          status: hop.status,
          headers: hop.location ? { location: hop.location } : {},
        });
      }),
    );
    return seen;
  }

  const identity = createCrawlIdentity({ site, accessKey: KEY });

  it('drops the key on a redirect to another host', async () => {
    const seen = stubChain({
      'https://example.com/blog': { status: 301, location: 'https://medium.com/@acme' },
    });
    const response = await crawlFetch('https://example.com/blog', identity, {
      headers: { Accept: 'text/html' },
    });

    expect(response.status).toBe(200);
    expect(seen.map((s) => s.url)).toEqual([
      'https://example.com/blog',
      'https://medium.com/@acme',
    ]);
    expect(seen[0]!.headers[ACCESS_KEY_HEADER]).toBe(KEY);
    expect(seen[1]!.headers).not.toHaveProperty(ACCESS_KEY_HEADER);
    // Caller headers ride along on every hop.
    expect(seen[1]!.headers.Accept).toBe('text/html');
  });

  it('keeps the key across same-site hops, resolving relative locations', async () => {
    const seen = stubChain({
      'http://example.com/': { status: 301, location: 'https://www.example.com/' },
      'https://www.example.com/': { status: 302, location: '/home' },
    });
    await crawlFetch('http://example.com/', identity);

    expect(seen.map((s) => s.url)).toEqual([
      'http://example.com/',
      'https://www.example.com/',
      'https://www.example.com/home',
    ]);
    for (const hop of seen) expect(hop.headers[ACCESS_KEY_HEADER]).toBe(KEY);
  });

  it('gives up on a redirect loop instead of spinning', async () => {
    stubChain({
      'https://example.com/a': { status: 302, location: '/b' },
      'https://example.com/b': { status: 302, location: '/a' },
    });
    await expect(crawlFetch('https://example.com/a', identity)).rejects.toThrow(
      /too many redirects/i,
    );
  });
});
