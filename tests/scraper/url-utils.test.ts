import { describe, expect, it } from 'vitest';
import {
  buildSite,
  isSameSite,
  normalizeUrl,
  shouldSkipUrl,
} from '../../vps-scraper/src/url-utils.js';

/**
 * The crawler's correctness core. Everything here is pure, and a regression
 * shows up as either a re-crawled duplicate (normalizeUrl), an off-site crawl
 * (isSameSite), or a wasted fetch of a binary/auth page (shouldSkipUrl).
 */

describe('normalizeUrl', () => {
  it('lowercases the host and keeps the root slash', () => {
    expect(normalizeUrl('https://Example.COM')).toBe('https://example.com/');
  });

  it('strips a trailing slash on non-root paths so /a/b/ and /a/b dedupe', () => {
    expect(normalizeUrl('https://example.com/a/b/')).toBe('https://example.com/a/b');
    expect(normalizeUrl('https://example.com/a/b')).toBe('https://example.com/a/b');
  });

  it('drops the fragment', () => {
    expect(normalizeUrl('https://example.com/p#section')).toBe('https://example.com/p');
  });

  it('drops tracking params and sorts the rest deterministically', () => {
    expect(normalizeUrl('https://example.com/p?utm_source=x&b=2&a=1')).toBe(
      'https://example.com/p?a=1&b=2',
    );
    // Order of the input query must not change the output.
    expect(normalizeUrl('https://example.com/p?b=2&a=1')).toBe(
      normalizeUrl('https://example.com/p?a=1&b=2'),
    );
  });

  it('drops the less obvious tracking params too', () => {
    for (const param of ['fbclid', 'gclid', 'mc_eid', 'igshid', 'ref', 'source', 'src']) {
      expect(normalizeUrl(`https://example.com/p?${param}=abc`)).toBe(
        'https://example.com/p',
      );
    }
  });

  it('removes default ports but keeps non-default ones', () => {
    expect(normalizeUrl('https://example.com:443/x')).toBe('https://example.com/x');
    expect(normalizeUrl('http://example.com:80/x')).toBe('http://example.com/x');
    expect(normalizeUrl('http://example.com:8080/x')).toBe('http://example.com:8080/x');
  });

  it('returns null for non-http(s) schemes and unparseable input', () => {
    expect(normalizeUrl('mailto:hi@example.com')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('ftp://example.com/x')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });
});

describe('isSameSite', () => {
  const site = buildSite('https://example.com')!;

  it('treats www and the bare host as the same site', () => {
    expect(isSameSite('https://www.example.com/x', site)).toBe(true);
    expect(isSameSite('https://example.com/x', site)).toBe(true);
    expect(isSameSite('http://example.com/x', site)).toBe(true);
  });

  it('treats other subdomains as external', () => {
    expect(isSameSite('https://blog.example.com/x', site)).toBe(false);
    expect(isSameSite('https://cdn.example.com/x', site)).toBe(false);
  });

  it('is not fooled by a suffix-matching host', () => {
    expect(isSameSite('https://example.com.evil.com/x', site)).toBe(false);
    expect(isSameSite('https://notexample.com/x', site)).toBe(false);
  });

  it('rejects non-http(s) and unparseable URLs', () => {
    expect(isSameSite('mailto:hi@example.com', site)).toBe(false);
    expect(isSameSite('not a url', site)).toBe(false);
  });
});

describe('buildSite', () => {
  it('strips www and lowercases', () => {
    expect(buildSite('https://WWW.Example.com/path')).toEqual({
      hostname: 'example.com',
    });
  });

  it('returns null for non-http(s) or unparseable input', () => {
    expect(buildSite('ftp://example.com')).toBeNull();
    expect(buildSite('nonsense')).toBeNull();
  });
});

describe('shouldSkipUrl', () => {
  it('skips non-HTML assets by extension', () => {
    for (const url of [
      'https://example.com/logo.png',
      'https://example.com/manual.pdf',
      'https://example.com/app.js',
      'https://example.com/styles.css',
      'https://example.com/archive.zip',
      'https://example.com/clip.mp4',
    ]) {
      expect(shouldSkipUrl(url), url).toBe(true);
    }
  });

  it('does not treat a dot in a directory name as a file extension', () => {
    expect(shouldSkipUrl('https://example.com/v1.2/guide')).toBe(false);
  });

  it('skips auth, account and admin paths', () => {
    for (const url of [
      'https://example.com/cart',
      'https://example.com/checkout/',
      'https://example.com/login',
      'https://example.com/my-account/orders',
      'https://example.com/wp-admin/',
      'https://example.com/wp-login.php',
    ]) {
      expect(shouldSkipUrl(url), url).toBe(true);
    }
  });

  it('skips feeds and faceted-search query traps', () => {
    expect(shouldSkipUrl('https://example.com/feed')).toBe(true);
    expect(shouldSkipUrl('https://example.com/shop?orderby=price')).toBe(true);
    expect(shouldSkipUrl('https://example.com/shop?filter_color=red')).toBe(true);
    expect(shouldSkipUrl('https://example.com/p?add-to-cart=42')).toBe(true);
  });

  it('skips only deep pagination tails, not ordinary page 2', () => {
    expect(shouldSkipUrl('https://example.com/blog/page/2')).toBe(false);
    expect(shouldSkipUrl('https://example.com/blog/page/1000')).toBe(true);
  });

  it('keeps ordinary content URLs', () => {
    for (const url of [
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/docs/getting-started',
      'https://example.com/products/widget?variant=blue',
    ]) {
      expect(shouldSkipUrl(url), url).toBe(false);
    }
  });

  it('skips anything unparseable or non-http(s)', () => {
    expect(shouldSkipUrl('not a url')).toBe(true);
    expect(shouldSkipUrl('mailto:hi@example.com')).toBe(true);
  });
});
