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

  describe('verifyToken', () => {
    it('is optional — unverified sites send no crawl credential at all', () => {
      const parsed = crawlRequestSchema.safeParse(validRequest);
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.verifyToken).toBeUndefined();
    });

    it('passes a real token through untouched', () => {
      const token = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
      const parsed = crawlRequestSchema.safeParse({
        ...validRequest,
        verifyToken: token,
      });
      expect(parsed.success && parsed.data.verifyToken).toBe(token);
    });

    it('rejects a token too short to be one of ours, or absurdly long', () => {
      expect(
        crawlRequestSchema.safeParse({ ...validRequest, verifyToken: 'short' }).success,
      ).toBe(false);
      expect(
        crawlRequestSchema.safeParse({ ...validRequest, verifyToken: 'x'.repeat(257) })
          .success,
      ).toBe(false);
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
