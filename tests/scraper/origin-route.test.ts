import { describe, expect, it } from 'vitest';
import { createOriginRoute } from '../../vps-scraper/src/origin-route.js';

/**
 * The crawl-host rewrite.
 *
 * Two properties matter and pull in opposite directions. The rewrite has to
 * actually happen (or the whole feature does nothing), and it has to happen
 * *only* at the socket — everything the crawler stores, dedups or reports must
 * stay on the site's real hostname. The third property is the security one:
 * a crawl host that isn't a subdomain of the site would let a caller route one
 * tenant's crawl through a host they control.
 */

describe('createOriginRoute', () => {
  describe('without a crawl host', () => {
    const route = createOriginRoute({ siteHostname: 'example.com' });

    it('is the identity route', () => {
      expect(route.crawlHost).toBeNull();
      expect(route.resolve('https://example.com/help')).toEqual({
        url: 'https://example.com/help',
        insecureTls: false,
      });
      expect(route.toCanonical('https://example.com/help')).toBe(
        'https://example.com/help',
      );
    });
  });

  describe('with a crawl host', () => {
    const route = createOriginRoute({
      siteHostname: 'example.com',
      crawlHost: 'crawl.example.com',
    });

    it('rewrites the site host and marks the hop as TLS-lenient', () => {
      // The origin's certificate is issued for example.com, so it can never
      // match crawl.example.com — verifying would fail every request.
      expect(route.resolve('https://example.com/help')).toEqual({
        url: 'https://crawl.example.com/help',
        insecureTls: true,
      });
    });

    it('rewrites the www form too', () => {
      expect(route.resolve('https://www.example.com/help').url).toBe(
        'https://crawl.example.com/help',
      );
    });

    it('preserves path, query and scheme', () => {
      expect(route.resolve('http://example.com/a/b?x=1&y=2').url).toBe(
        'http://crawl.example.com/a/b?x=1&y=2',
      );
    });

    it('leaves third-party hosts alone, at full TLS verification', () => {
      expect(route.resolve('https://cdn.other.test/x')).toEqual({
        url: 'https://cdn.other.test/x',
        insecureTls: false,
      });
    });

    it('leaves other subdomains of the same site alone', () => {
      // The crawler is strictly same-site and never enqueues these, but the
      // route must not invent a crawl host for something it can't serve.
      expect(route.resolve('https://blog.example.com/x').url).toBe(
        'https://blog.example.com/x',
      );
    });

    it('maps a crawl-host URL back to the canonical hostname', () => {
      expect(route.toCanonical('https://crawl.example.com/help')).toBe(
        'https://example.com/help',
      );
    });

    it('leaves anything else unchanged when canonicalising', () => {
      expect(route.toCanonical('https://other.test/x')).toBe('https://other.test/x');
    });

    it('survives an unparseable URL', () => {
      expect(route.resolve('not a url')).toEqual({
        url: 'not a url',
        insecureTls: false,
      });
      expect(route.toCanonical('not a url')).toBe('not a url');
    });
  });

  it('refuses a crawl host that is not a subdomain of the site', () => {
    // Holding the scraper API key gets you a crawl of the site you named, not
    // the right to route it through a host you control.
    for (const crawlHost of [
      'crawl.evil.test',
      'example.com.evil.test',
      'example.com',
      'crawlexample.com',
    ]) {
      const route = createOriginRoute({ siteHostname: 'example.com', crawlHost });
      expect(route.crawlHost, crawlHost).toBeNull();
      expect(route.resolve('https://example.com/x').url, crawlHost).toBe(
        'https://example.com/x',
      );
    }
  });

  it('normalises case and a trailing dot on the crawl host', () => {
    const route = createOriginRoute({
      siteHostname: 'example.com',
      crawlHost: 'Crawl.Example.com.',
    });
    expect(route.crawlHost).toBe('crawl.example.com');
  });
});
