import { describe, expect, it } from 'vitest';
import {
  crawlHostFor,
  hostInZone,
  hostnameOf,
  pickZoneForHost,
  relativeRecordName,
  stripWww,
} from '@/lib/sites/domains';

/**
 * The hostname arithmetic behind the DNS integration.
 *
 * Every function here decides something that ends up written into a customer's
 * live DNS zone, so the cases that matter are the ones where a plausible-looking
 * shortcut is wrong: suffix matching without a label boundary, `www.` handling,
 * and multi-label zones.
 */

describe('hostnameOf', () => {
  it('pulls the host out of a stored site URL', () => {
    expect(hostnameOf('https://Example.com/help?a=1')).toBe('example.com');
  });

  it('returns a malformed value as itself rather than throwing', () => {
    // Site rows predate the URL validation, and a server component rendering
    // one must not 500 over it.
    expect(hostnameOf('not a url')).toBe('not a url');
  });
});

describe('stripWww', () => {
  it('drops a leading www and nothing else', () => {
    expect(stripWww('www.example.com')).toBe('example.com');
    expect(stripWww('wwwx.example.com')).toBe('wwwx.example.com');
    expect(stripWww('shop.www.example.com')).toBe('shop.www.example.com');
  });
});

describe('crawlHostFor', () => {
  it('builds crawl.<apex> from a site URL', () => {
    expect(crawlHostFor('https://example.com')).toBe('crawl.example.com');
  });

  it('strips www so the record lands in the zone that exists', () => {
    // crawl.www.example.com would need a record nobody has, and the zone is
    // example.com either way.
    expect(crawlHostFor('https://www.example.com/docs')).toBe('crawl.example.com');
  });

  it('keeps a real subdomain', () => {
    expect(crawlHostFor('https://shop.example.com')).toBe('crawl.shop.example.com');
  });
});

describe('hostInZone', () => {
  it('accepts the apex and true subdomains', () => {
    expect(hostInZone('example.com', 'example.com')).toBe(true);
    expect(hostInZone('crawl.example.com', 'example.com')).toBe(true);
  });

  it('rejects a host that merely ends with the zone name', () => {
    // The label boundary is the whole point: notexample.com is a different
    // registration, and matching it would write records into a stranger's zone.
    expect(hostInZone('notexample.com', 'example.com')).toBe(false);
    expect(hostInZone('example.com.evil.test', 'example.com')).toBe(false);
  });

  it('ignores case and trailing dots', () => {
    expect(hostInZone('Crawl.Example.com.', 'example.com')).toBe(true);
  });
});

describe('pickZoneForHost', () => {
  const zones = [
    { id: '1', name: 'example.com' },
    { id: '2', name: 'shop.example.com' },
    { id: '3', name: 'other.test' },
  ];

  it('prefers the most specific zone', () => {
    // An account can hold both; a record for shop.example.com belongs in the
    // delegated zone, not the parent.
    expect(pickZoneForHost(zones, 'crawl.shop.example.com')?.id).toBe('2');
  });

  it('falls back to the parent zone', () => {
    expect(pickZoneForHost(zones, 'crawl.example.com')?.id).toBe('1');
  });

  it('returns null when nothing covers the host', () => {
    expect(pickZoneForHost(zones, 'crawl.unrelated.test')).toBeNull();
  });
});

describe('relativeRecordName', () => {
  it('returns the label for a subdomain', () => {
    expect(relativeRecordName('crawl.example.com', 'example.com')).toBe('crawl');
  });

  it('returns @ for the apex', () => {
    expect(relativeRecordName('example.com', 'example.com')).toBe('@');
  });

  it('keeps intermediate labels when the zone is higher up', () => {
    expect(relativeRecordName('crawl.shop.example.com', 'example.com')).toBe(
      'crawl.shop',
    );
  });

  it('returns null when the host is outside the zone', () => {
    expect(relativeRecordName('crawl.other.test', 'example.com')).toBeNull();
  });
});
