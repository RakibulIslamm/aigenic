import { describe, expect, it } from 'vitest';
import { isDisallowedHost, isPublicAddress } from '@/lib/http/public-url';
import { assertAllowedHostname } from '../../vps-scraper/src/ssrf-guard.js';

/**
 * The app's input-boundary half of the SSRF defense. It is a hand-maintained
 * mirror of `vps-scraper/src/ssrf-guard.ts` (separate workspaces, no shared
 * package), so the parity block at the bottom is the point of this file: it
 * imports *both* implementations and fails the moment they disagree.
 */

const NON_PUBLIC_LITERALS = [
  '169.254.169.254', // cloud metadata — the one that hands out credentials
  '127.0.0.1',
  '10.0.0.5',
  '172.16.0.1',
  '192.168.1.1',
  '100.64.0.1', // carrier-grade NAT
  '0.0.0.0',
  '255.255.255.255',
  '224.0.0.1',
  '::1',
  'fd00::1',
  'fe80::1',
  '::ffff:169.254.169.254', // IPv4-mapped
  '64:ff9b::a9fe:a9fe', // NAT64 route to the metadata address
  '2002:7f00:1::', // 6to4 of 127.0.0.1
];

const PUBLIC_LITERALS = [
  '93.184.216.34',
  '1.1.1.1',
  '2606:4700:4700::1111',
  '64:ff9b::14cd:f3a6', // NAT64 of 20.205.243.166 — normal on an IPv6-only network
];

const NON_PUBLIC_NAMES = [
  'localhost',
  'LOCALHOST',
  'foo.localhost',
  'printer.local',
  'metadata.internal',
  'router.home.arpa',
  'intranet', // resolvable only through a local search domain
  '',
];

const PUBLIC_NAMES = ['example.com', 'shop.example.co.uk', 'example.com.'];

describe('isPublicAddress', () => {
  it.each(PUBLIC_LITERALS)('accepts %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each(NON_PUBLIC_LITERALS)('rejects %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it('rejects anything that is not an address at all', () => {
    expect(isPublicAddress('example.com')).toBe(false);
    expect(isPublicAddress('')).toBe(false);
  });
});

describe('isDisallowedHost', () => {
  it.each([...NON_PUBLIC_LITERALS, ...NON_PUBLIC_NAMES])('blocks %s', (host) => {
    expect(isDisallowedHost(host)).toBe(true);
  });

  it.each([...PUBLIC_LITERALS, ...PUBLIC_NAMES])('allows %s', (host) => {
    expect(isDisallowedHost(host)).toBe(false);
  });

  it('strips the brackets URL parsing leaves on an IPv6 host', () => {
    expect(new URL('http://[::1]/').hostname).toBe('[::1]');
    expect(isDisallowedHost('[::1]')).toBe(true);
    expect(isDisallowedHost('[2606:4700:4700::1111]')).toBe(false);
  });
});

describe('the obfuscated IPv4 spellings URL parsing normalizes for us', () => {
  // Worth pinning: `isDisallowedHost` never sees these forms, because the
  // WHATWG parser has already turned every one of them into '127.0.0.1'. If
  // that ever stopped being true, the decimal/octal/hex bypass would be live.
  it.each([
    'http://0177.0.0.1/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://127.1/',
  ])('%s normalizes to a host we block', (value) => {
    const { hostname } = new URL(value);
    expect(hostname).toBe('127.0.0.1');
    expect(isDisallowedHost(hostname)).toBe(true);
  });
});

describe('parity with the crawler guard', () => {
  // If this fails, the two copies have drifted — fix the mirror, don't relax
  // the test. The app copy exists to reject early; the crawler copy is what
  // actually stops the request, and a host the app lets through must still be
  // blocked there (never the other way round, which would be a lie in the UI).
  const scraperBlocks = (host: string): boolean => {
    try {
      assertAllowedHostname(host);
      return false;
    } catch {
      return true;
    }
  };

  it.each([
    ...NON_PUBLIC_LITERALS,
    ...NON_PUBLIC_NAMES,
    ...PUBLIC_LITERALS,
    ...PUBLIC_NAMES,
    '[::1]',
    'sub.domain.example.org',
  ])('agrees on %s', (host) => {
    expect(isDisallowedHost(host)).toBe(scraperBlocks(host));
  });
});
