import { describe, expect, it } from 'vitest';
import { detectOrigin, zoneCoversHost } from '@/lib/dns/origin';
import type { DnsRecord } from '@/lib/dns/types';

/**
 * Origin auto-detection decides what address a customer's new DNS record will
 * point at, so it is pure and tested from a record list rather than from a
 * provider. Getting it wrong writes a bad record into a live zone — and the
 * two ways to get it wrong are picking an unreachable address, or picking
 * nothing when a perfectly good one was there.
 */

const record = (over: Partial<DnsRecord> & Pick<DnsRecord, 'name' | 'type' | 'value'>) =>
  ({ id: null, ttl: 300, ...over }) as DnsRecord;

describe('detectOrigin', () => {
  it('prefers a record for the exact enrolled host', () => {
    const detection = detectOrigin({
      records: [
        record({ name: 'example.com', type: 'A', value: '93.184.216.34' }),
        record({ name: 'www.example.com', type: 'A', value: '93.184.216.35' }),
      ],
      siteHost: 'www.example.com',
      zoneName: 'example.com',
    });
    expect(detection.ok && detection.origin.address).toBe('93.184.216.35');
    expect(detection.ok && detection.origin.source).toBe('www.example.com');
  });

  it('falls back to the apex', () => {
    const detection = detectOrigin({
      records: [record({ name: 'example.com', type: 'A', value: '93.184.216.34' })],
      siteHost: 'www.example.com',
      zoneName: 'example.com',
    });
    expect(detection.ok && detection.origin.address).toBe('93.184.216.34');
  });

  it('prefers IPv4 over IPv6 at the same name', () => {
    // A stale AAAA alongside a working A is common enough that picking the
    // v6 address would silently produce an unreachable crawl host.
    const detection = detectOrigin({
      records: [
        record({
          name: 'example.com',
          type: 'AAAA',
          value: '2606:2800:220:1:248:1893:25c8:1946',
        }),
        record({ name: 'example.com', type: 'A', value: '93.184.216.34' }),
      ],
      siteHost: 'example.com',
      zoneName: 'example.com',
    });
    expect(detection.ok && detection.origin.type).toBe('A');
  });

  it('uses AAAA when that is all there is', () => {
    const detection = detectOrigin({
      records: [
        record({
          name: 'example.com',
          type: 'AAAA',
          value: '2606:2800:220:1:248:1893:25c8:1946',
        }),
      ],
      siteHost: 'example.com',
      zoneName: 'example.com',
    });
    expect(detection.ok && detection.origin.type).toBe('AAAA');
  });

  it('ignores the crawl record it previously created', () => {
    // Otherwise a re-run rediscovers our own record and pins the old origin
    // forever — which is exactly the case "Re-detect origin" exists to fix.
    const detection = detectOrigin({
      records: [
        record({ name: 'crawl.example.com', type: 'A', value: '93.184.216.99' }),
        record({ name: 'example.com', type: 'A', value: '93.184.216.34' }),
      ],
      siteHost: 'example.com',
      zoneName: 'example.com',
      excludeName: 'crawl.example.com',
    });
    expect(detection.ok && detection.origin.address).toBe('93.184.216.34');
  });

  it('refuses a private, loopback, link-local or reserved address', () => {
    // 203.0.113.x is RFC 5737 documentation space and is refused for the same
    // reason as 10.x: a crawl host pointed there resolves to nothing our VPS
    // can reach, and the scraper's own SSRF guard would refuse the connection.
    for (const value of [
      '10.0.0.5',
      '127.0.0.1',
      '169.254.169.254',
      '192.168.1.1',
      '100.64.0.1',
      '203.0.113.10',
    ]) {
      const detection = detectOrigin({
        records: [record({ name: 'example.com', type: 'A', value })],
        siteHost: 'example.com',
        zoneName: 'example.com',
      });
      expect(detection.ok, value).toBe(false);
      expect(!detection.ok && detection.reason, value).toBe('non_public');
    }
  });

  it('reports a CNAME-only zone as aliased', () => {
    const detection = detectOrigin({
      records: [
        record({ name: 'example.com', type: 'CNAME', value: 'app.vercel-dns.com' }),
      ],
      siteHost: 'example.com',
      zoneName: 'example.com',
    });
    expect(!detection.ok && detection.reason).toBe('aliased');
  });

  it('reports an empty zone as missing', () => {
    const detection = detectOrigin({
      records: [record({ name: 'mail.example.com', type: 'A', value: '93.184.216.55' })],
      siteHost: 'example.com',
      zoneName: 'example.com',
    });
    expect(!detection.ok && detection.reason).toBe('missing');
  });
});

describe('zoneCoversHost', () => {
  it('accepts the zone that serves the site', () => {
    expect(zoneCoversHost('example.com', 'www.example.com')).toBe(true);
    expect(zoneCoversHost('example.com', 'example.com')).toBe(true);
  });

  it('rejects an unrelated zone from the same account', () => {
    // The zone id arrives from a browser form; without this a crafted request
    // could add a `crawl.` record to any other zone the credentials can see.
    expect(zoneCoversHost('other.test', 'example.com')).toBe(false);
    expect(zoneCoversHost('example.com', 'notexample.com')).toBe(false);
  });
});
