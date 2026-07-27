import { describe, expect, it } from 'vitest';
import { crawlRequestSchema } from '../../vps-scraper/src/schemas.js';

/**
 * The scraper's `/crawl` payload boundary. Holding the API key gets you a
 * crawl, not a proxy into the box's network — so `startUrl` is checked here
 * too, not only in the dashboard form that normally produces it.
 */

const validRequest = {
  siteId: '6b4d2b1a-0f3e-4a1c-9b7e-2f8c1d5a7e90',
  startUrl: 'https://example.com',
  maxPages: 500,
  webhookUrl: 'http://127.0.0.1:3000/api/scraper/webhook',
};

describe('crawlRequestSchema', () => {
  it('accepts a well-formed request', () => {
    const parsed = crawlRequestSchema.parse(validRequest);
    expect(parsed.startUrl).toBe('https://example.com');
    expect(parsed.maxPages).toBe(500);
  });

  it('defaults maxPages when omitted', () => {
    const { maxPages, ...withoutMaxPages } = validRequest;
    void maxPages;
    expect(crawlRequestSchema.parse(withoutMaxPages).maxPages).toBe(1000);
  });

  it('rejects a non-public startUrl', () => {
    for (const startUrl of [
      'http://169.254.169.254/latest/meta-data/',
      'http://[::ffff:169.254.169.254]/',
      'http://localhost:3000/',
      'http://10.0.0.5/',
      'http://192.168.1.1/admin',
      'http://100.64.0.1/',
      'http://intranet/',
      'http://metadata.internal/',
      'http://0177.0.0.1/',
      'file:///etc/passwd',
    ]) {
      expect(
        crawlRequestSchema.safeParse({ ...validRequest, startUrl }).success,
        startUrl,
      ).toBe(false);
    }
  });

  it('still accepts ordinary public start URLs', () => {
    for (const startUrl of [
      'https://example.com',
      'http://example.com/help',
      'https://shop.example.co.uk/docs?a=1',
    ]) {
      expect(
        crawlRequestSchema.safeParse({ ...validRequest, startUrl }).success,
        startUrl,
      ).toBe(true);
    }
  });

  it('leaves webhookUrl unguarded — it is our own app, and dev points at loopback', () => {
    expect(
      crawlRequestSchema.safeParse({
        ...validRequest,
        webhookUrl: 'http://127.0.0.1:3000/api/scraper/webhook',
      }).success,
    ).toBe(true);
  });

  describe('generation', () => {
    // Echoed back on every webhook so the app can tell this crawl's articles
    // apart from a superseded crawl's. See aigenic_app/lib/sites/generations.ts.
    it('defaults to 0 for a direct API call that omits it', () => {
      const { generation, ...without } = { ...validRequest, generation: 3 };
      void generation;
      expect(crawlRequestSchema.parse(without).generation).toBe(0);
    });

    it('passes a supplied generation straight through', () => {
      expect(
        crawlRequestSchema.parse({ ...validRequest, generation: 7 }).generation,
      ).toBe(7);
    });

    it('rejects a negative or fractional generation', () => {
      for (const generation of [-1, 2.5, 'three']) {
        expect(
          crawlRequestSchema.safeParse({ ...validRequest, generation }).success,
          String(generation),
        ).toBe(false);
      }
    });
  });

  describe('crawlHost', () => {
    // Only the *shape* is checked here. Whether the host actually belongs to
    // the site is decided in origin-route.ts, which owns the registrable-host
    // rule — see the note on the schema field.
    it('is optional — a site with no DNS connection crawls its own hostname', () => {
      const parsed = crawlRequestSchema.safeParse(validRequest);
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.crawlHost).toBeUndefined();
    });

    it('passes a hostname through untouched', () => {
      const parsed = crawlRequestSchema.safeParse({
        ...validRequest,
        crawlHost: 'crawl.example.com',
      });
      expect(parsed.success && parsed.data.crawlHost).toBe('crawl.example.com');
    });

    it('rejects anything that is not a bare hostname', () => {
      for (const crawlHost of [
        'https://crawl.example.com',
        'crawl.example.com/path',
        'crawl example.com',
        'crawl',
        `crawl.${'x'.repeat(260)}.com`,
        '-crawl.example.com',
      ]) {
        expect(
          crawlRequestSchema.safeParse({ ...validRequest, crawlHost }).success,
          crawlHost,
        ).toBe(false);
      }
    });
  });

  it('rejects a malformed siteId or page budget', () => {
    expect(
      crawlRequestSchema.safeParse({ ...validRequest, siteId: 'nope' }).success,
    ).toBe(false);
    expect(crawlRequestSchema.safeParse({ ...validRequest, maxPages: 0 }).success).toBe(
      false,
    );
    expect(
      crawlRequestSchema.safeParse({ ...validRequest, maxPages: 2001 }).success,
    ).toBe(false);
  });
});
