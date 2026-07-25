import { describe, expect, it } from 'vitest';
import {
  assertAllowedHostname,
  assertPublicUrl,
  isPublicAddress,
  isSsrfBlocked,
  resolveRedirectTarget,
  SsrfBlockedError,
} from '../../vps-scraper/src/ssrf-guard.js';

/**
 * The crawler's SSRF boundary. A regression here is not a bug report — it's
 * the VPS acting as a proxy into its own network, with whatever it fetches
 * ingested as an "article" and then readable through the public support
 * widget. The metadata address (169.254.169.254) is the case that matters
 * most: on a cloud host it hands out credentials.
 *
 * Only the synchronous, pure checks are covered here. The connect-time DNS
 * check and the per-hop redirect check need real sockets and are exercised
 * by the manual verification steps in the plan.
 */

function blockReason(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof SsrfBlockedError) return err.detail;
    return `wrong error: ${String(err)}`;
  }
  return 'NOT BLOCKED';
}

describe('isPublicAddress', () => {
  it('accepts routable unicast addresses', () => {
    expect(isPublicAddress('93.184.216.34')).toBe(true);
    expect(isPublicAddress('1.1.1.1')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it.each([
    ['169.254.169.254', 'cloud metadata / link-local'],
    ['127.0.0.1', 'loopback'],
    ['10.0.0.5', 'RFC 1918'],
    ['172.16.0.1', 'RFC 1918'],
    ['192.168.1.1', 'RFC 1918'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['0.0.0.0', 'unspecified'],
    ['255.255.255.255', 'broadcast'],
    ['224.0.0.1', 'multicast'],
    ['::1', 'IPv6 loopback'],
    ['fd00::1', 'IPv6 unique-local'],
    ['fe80::1', 'IPv6 link-local'],
  ])('rejects %s (%s)', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it('judges IPv4-mapped IPv6 on the address it carries', () => {
    // Without the unwrap this reads as a plain unicast v6 address and passes.
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicAddress('::ffff:169.254.169.254')).toBe(false);
    expect(isPublicAddress('::ffff:93.184.216.34')).toBe(true);
    // RFC 6145 IPv4-translated, the other ::ffff: spelling.
    expect(isPublicAddress('::ffff:0:127.0.0.1')).toBe(false);
    expect(isPublicAddress('::ffff:0:93.184.216.34')).toBe(true);
  });

  it('decodes NAT64 (64:ff9b::/96) instead of blanket-allowing or blanket-blocking', () => {
    // On an IPv6-only / NAT64 network *every* public IPv4 site resolves into
    // this prefix, so rejecting the range outright stops the crawler dead —
    // and accepting it outright hands over the metadata service.
    expect(isPublicAddress('64:ff9b::14cd:f3a6')).toBe(true); // 20.205.243.166
    expect(isPublicAddress('64:ff9b::a9fe:a9fe')).toBe(false); // 169.254.169.254
    expect(isPublicAddress('64:ff9b::7f00:1')).toBe(false); // 127.0.0.1
    expect(isPublicAddress('64:ff9b::a00:5')).toBe(false); // 10.0.0.5
  });

  it('refuses legacy IPv6 tunnelling outright', () => {
    // 6to4/Teredo hide the v4 address somewhere other than the low 32 bits and
    // are never a real DNS answer for a website — decode nothing, allow nothing.
    expect(isPublicAddress('2002:7f00:1::')).toBe(false); // 6to4 of 127.0.0.1
    expect(isPublicAddress('2001:0:4136:e378:8000:63bf:3fff:fdd2')).toBe(false);
  });

  it('rejects anything that is not an address at all', () => {
    expect(isPublicAddress('example.com')).toBe(false);
    expect(isPublicAddress('')).toBe(false);
  });
});

describe('assertAllowedHostname', () => {
  it('allows ordinary public hostnames', () => {
    expect(() => assertAllowedHostname('example.com')).not.toThrow();
    expect(() => assertAllowedHostname('shop.example.co.uk')).not.toThrow();
    // Trailing-dot FQDN form.
    expect(() => assertAllowedHostname('example.com.')).not.toThrow();
  });

  it('blocks names that can only resolve internally', () => {
    expect(blockReason(() => assertAllowedHostname('localhost'))).toBe('localhost');
    expect(blockReason(() => assertAllowedHostname('LOCALHOST'))).toBe('localhost');
    expect(blockReason(() => assertAllowedHostname('foo.localhost'))).toBe(
      'internal-only TLD',
    );
    expect(blockReason(() => assertAllowedHostname('printer.local'))).toBe(
      'internal-only TLD',
    );
    expect(blockReason(() => assertAllowedHostname('metadata.internal'))).toBe(
      'internal-only TLD',
    );
    // Only resolvable via a local search domain.
    expect(blockReason(() => assertAllowedHostname('intranet'))).toBe(
      'bare single-label hostname',
    );
  });

  it('blocks non-public IP literals, brackets and all', () => {
    expect(blockReason(() => assertAllowedHostname('169.254.169.254'))).toBe(
      'non-public IP literal',
    );
    // `new URL('http://[::1]/').hostname` keeps the brackets.
    expect(blockReason(() => assertAllowedHostname('[::1]'))).toBe(
      'non-public IP literal',
    );
  });
});

describe('assertPublicUrl', () => {
  it('returns the parsed URL for a crawlable target', () => {
    expect(assertPublicUrl('https://example.com/docs').hostname).toBe('example.com');
  });

  it('blocks the metadata endpoint in every spelling', () => {
    expect(
      blockReason(() => assertPublicUrl('http://169.254.169.254/latest/meta-data/')),
    ).toBe('non-public IP literal');
    expect(blockReason(() => assertPublicUrl('http://[::ffff:169.254.169.254]/'))).toBe(
      'non-public IP literal',
    );
  });

  it('blocks schemes that are not http(s)', () => {
    expect(blockReason(() => assertPublicUrl('file:///etc/passwd'))).toBe('scheme file:');
    expect(blockReason(() => assertPublicUrl('gopher://example.com/'))).toBe(
      'scheme gopher:',
    );
    expect(blockReason(() => assertPublicUrl('ftp://example.com/'))).toBe('scheme ftp:');
  });

  it('blocks garbage rather than throwing something unexpected', () => {
    expect(blockReason(() => assertPublicUrl('not a url'))).toBe('unparseable URL');
  });
});

describe('resolveRedirectTarget', () => {
  // This is the hop check. `redirect: 'follow'` would make all of these
  // invisible: a perfectly public page 302s and the fetch lands wherever it
  // was pointed.
  it('follows ordinary same-site and cross-site redirects', () => {
    expect(resolveRedirectTarget('https://example.com/a', '/b')).toBe(
      'https://example.com/b',
    );
    expect(resolveRedirectTarget('https://example.com/a', 'https://other.com/c')).toBe(
      'https://other.com/c',
    );
  });

  it('blocks a public page redirecting to the metadata endpoint', () => {
    expect(
      blockReason(() =>
        resolveRedirectTarget('https://example.com/a', 'http://169.254.169.254/'),
      ),
    ).toBe('non-public IP literal');
  });

  it('blocks a protocol-relative redirect to a private host', () => {
    // `//host/path` inherits the current scheme — easy to mistake for a path.
    expect(
      blockReason(() =>
        resolveRedirectTarget('https://example.com/a', '//169.254.169.254/'),
      ),
    ).toBe('non-public IP literal');
    expect(
      blockReason(() => resolveRedirectTarget('https://example.com/a', '//localhost/')),
    ).toBe('localhost');
  });

  it('blocks a scheme change to file:', () => {
    expect(
      blockReason(() =>
        resolveRedirectTarget('https://example.com/a', 'file:///etc/passwd'),
      ),
    ).toBe('scheme file:');
  });
});

describe('isSsrfBlocked', () => {
  it('recognises the guard error directly and through a cause chain', () => {
    const blocked = new SsrfBlockedError('x', 'loopback');
    expect(isSsrfBlocked(blocked)).toBe(true);
    // undici wraps connect-phase failures.
    expect(isSsrfBlocked(new Error('fetch failed', { cause: blocked }))).toBe(true);
  });

  it('does not claim ordinary network failures', () => {
    expect(isSsrfBlocked(new Error('ECONNRESET'))).toBe(false);
    expect(isSsrfBlocked(undefined)).toBe(false);
  });
});
