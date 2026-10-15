import { describe, expect, it } from 'vitest';
import { crawlRequestSchema, probeRequestSchema } from '../../vps-scraper/src/schemas.js';

/** The scraper's `/crawl` payload boundary. */

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

  it('accepts any start URL, with no public-host restriction', () => {
    for (const startUrl of [
      'https://example.com',
      'http://example.com/help',
      'https://shop.example.co.uk/docs?a=1',
      'http://localhost:3000/',
      'http://192.168.1.1/admin',
    ]) {
      expect(
        crawlRequestSchema.safeParse({ ...validRequest, startUrl }).success,
        startUrl,
      ).toBe(true);
    }
  });

  it('rejects a startUrl that is not a URL', () => {
    expect(
      crawlRequestSchema.safeParse({ ...validRequest, startUrl: 'not a url' }).success,
    ).toBe(false);
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

/**
 * The access key is forwarded verbatim as an HTTP header value, so the schema
 * is the line that keeps CR/LF (header injection) and other junk out.
 */
describe('accessKey', () => {
  const key = '0123456789abcdef0123456789abcdef';

  it('is optional', () => {
    expect(crawlRequestSchema.parse(validRequest).accessKey).toBeUndefined();
  });

  it('accepts a hex key on /crawl and /probe', () => {
    expect(crawlRequestSchema.parse({ ...validRequest, accessKey: key }).accessKey).toBe(
      key,
    );
    expect(
      probeRequestSchema.parse({ url: 'https://example.com', accessKey: key }).accessKey,
    ).toBe(key);
  });

  it.each([`${key}\r\nX-Evil: 1`, 'short', key.toUpperCase(), `${key} `, ''])(
    'rejects %j',
    (accessKey) => {
      expect(crawlRequestSchema.safeParse({ ...validRequest, accessKey }).success).toBe(
        false,
      );
      expect(
        probeRequestSchema.safeParse({ url: 'https://example.com', accessKey }).success,
      ).toBe(false);
    },
  );
});
