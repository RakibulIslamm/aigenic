import { afterEach, describe, expect, it } from 'vitest';
import {
  createOriginRoute,
  type OriginRoute,
} from '../../vps-scraper/src/origin-route.js';

/**
 * Pinning a crawl to a site's origin.
 *
 * The design rule this suite exists to protect: the override is on **address
 * resolution only**. An earlier version rewrote the URL to `crawl.<domain>`
 * instead, and that fails on real hosting — managed hosts pick the vhost from
 * TLS SNI and abort the handshake on a name they don't serve, before any
 * certificate is presented, so `ignoreHTTPSErrors` cannot rescue it. Anything
 * here that starts translating URLs is that bug coming back.
 *
 * The security rule is the second one: the crawl host must be a subdomain of
 * the site, or an API-key holder could pin one tenant's crawl to an address
 * they control.
 */

const ORIGIN_V4 = ['93.184.216.34'];

const routes: OriginRoute[] = [];

async function build(params: {
  siteHostname: string;
  crawlHost?: string;
  resolve?: (hostname: string) => Promise<string[]>;
}) {
  const route = await createOriginRoute({
    ...params,
    resolve: params.resolve ?? (async () => ORIGIN_V4),
  });
  routes.push(route);
  return route;
}

afterEach(async () => {
  await Promise.all(routes.splice(0).map((route) => route.close()));
});

describe('createOriginRoute', () => {
  it('is inert without a crawl host', async () => {
    const route = await build({ siteHostname: 'example.com' });
    expect(route.crawlHost).toBeNull();
    expect(route.dispatcherFor('https://example.com/help')).toBeNull();
    expect(route.hostResolverRules()).toBeNull();
  });

  describe('with a crawl host', () => {
    it('pins the apex and its www form', async () => {
      const route = await build({
        siteHostname: 'example.com',
        crawlHost: 'crawl.example.com',
      });
      expect(route.crawlHost).toBe('crawl.example.com');
      expect(route.addresses).toEqual(ORIGIN_V4);
      expect(route.dispatcherFor('https://example.com/help')).not.toBeNull();
      expect(route.dispatcherFor('https://www.example.com/help')).not.toBeNull();
    });

    it('leaves every other host on ordinary DNS and full TLS verification', async () => {
      const route = await build({
        siteHostname: 'example.com',
        crawlHost: 'crawl.example.com',
      });
      // Including the crawl host itself — we never request it, we only resolve it.
      for (const url of [
        'https://cdn.other.test/x',
        'https://blog.example.com/x',
        'https://crawl.example.com/x',
        'not a url',
      ]) {
        expect(route.dispatcherFor(url), url).toBeNull();
      }
    });

    it('expresses the same override as a Chromium resolver rule', async () => {
      const route = await build({
        siteHostname: 'example.com',
        crawlHost: 'crawl.example.com',
      });
      expect(route.hostResolverRules()).toBe(
        'MAP example.com 93.184.216.34,MAP www.example.com 93.184.216.34',
      );
    });

    it('brackets an IPv6 origin in the resolver rule', async () => {
      const route = await build({
        siteHostname: 'example.com',
        crawlHost: 'crawl.example.com',
        resolve: async () => ['2606:2800:220:1:248:1893:25c8:1946'],
      });
      expect(route.hostResolverRules()).toContain(
        'MAP example.com [2606:2800:220:1:248:1893:25c8:1946]',
      );
    });

    it('normalises case and a trailing dot', async () => {
      const route = await build({
        siteHostname: 'example.com',
        crawlHost: 'Crawl.Example.com.',
      });
      expect(route.crawlHost).toBe('crawl.example.com');
    });
  });

  describe('refusing to pin', () => {
    it('rejects a crawl host outside the site', async () => {
      for (const crawlHost of [
        'crawl.evil.test',
        'example.com.evil.test',
        'example.com',
        'crawlexample.com',
      ]) {
        const route = await build({ siteHostname: 'example.com', crawlHost });
        expect(route.crawlHost, crawlHost).toBeNull();
        expect(route.dispatcherFor('https://example.com/x'), crawlHost).toBeNull();
      }
    });

    it('falls back to a normal crawl when the record does not resolve', async () => {
      const route = await build({
        siteHostname: 'example.com',
        crawlHost: 'crawl.example.com',
        resolve: async () => {
          throw new Error('ENOTFOUND');
        },
      });
      expect(route.crawlHost).toBeNull();
    });

    it('drops non-public addresses and falls back when none are left', async () => {
      // A customer's zone is user input: a crawl record pointed at
      // 169.254.169.254 would have the crawler read this box's cloud metadata
      // and file it as an article.
      const route = await build({
        siteHostname: 'example.com',
        crawlHost: 'crawl.example.com',
        resolve: async () => ['169.254.169.254', '10.0.0.5'],
      });
      expect(route.crawlHost).toBeNull();
    });

    it('keeps the public addresses when a record mixes them', async () => {
      const route = await build({
        siteHostname: 'example.com',
        crawlHost: 'crawl.example.com',
        resolve: async () => ['10.0.0.5', '93.184.216.34'],
      });
      expect(route.addresses).toEqual(['93.184.216.34']);
    });
  });
});
