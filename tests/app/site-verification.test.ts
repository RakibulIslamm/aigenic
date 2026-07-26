import { describe, expect, it } from 'vitest';
import {
  CRAWL_VERIFY_HEADER,
  DNS_TXT_PREFIX,
  DNS_TXT_SUBDOMAIN,
  dnsCandidateHosts,
  dnsRecordValue,
  hostnameOf,
  matchesDnsToken,
  matchesFileBody,
} from '@/lib/sites/verification';
import { randomToken } from '@/lib/ids';

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('dnsRecordValue', () => {
  it('prefixes the token so ours is findable among a zone full of TXT records', () => {
    expect(dnsRecordValue(TOKEN)).toBe(`${DNS_TXT_PREFIX}${TOKEN}`);
  });
});

describe('dnsCandidateHosts', () => {
  it('checks the documented subdomain before the apex', () => {
    expect(dnsCandidateHosts('example.com')).toEqual([
      `${DNS_TXT_SUBDOMAIN}.example.com`,
      'example.com',
    ]);
  });

  it('also checks the apex zone for a www host, where the record usually lives', () => {
    expect(dnsCandidateHosts('www.example.com')).toEqual([
      `${DNS_TXT_SUBDOMAIN}.www.example.com`,
      'www.example.com',
      `${DNS_TXT_SUBDOMAIN}.example.com`,
      'example.com',
    ]);
  });

  it('normalizes case and the FQDN trailing dot', () => {
    expect(dnsCandidateHosts('EXAMPLE.com.')).toEqual([
      `${DNS_TXT_SUBDOMAIN}.example.com`,
      'example.com',
    ]);
  });

  it('never returns a duplicate host to query', () => {
    const hosts = dnsCandidateHosts('www.example.com');
    expect(new Set(hosts).size).toBe(hosts.length);
  });
});

describe('matchesDnsToken', () => {
  it('accepts the published record', () => {
    expect(matchesDnsToken([[dnsRecordValue(TOKEN)]], TOKEN)).toBe(true);
  });

  it('rejoins the 255-byte chunks some DNS providers split records into', () => {
    const full = dnsRecordValue(TOKEN);
    const chunked = [full.slice(0, 20), full.slice(20)];
    expect(matchesDnsToken([chunked], TOKEN)).toBe(true);
  });

  it('finds ours among unrelated TXT records (SPF, other vendors)', () => {
    const records = [
      ['v=spf1 include:_spf.google.com ~all'],
      ['google-site-verification=abc123'],
      [dnsRecordValue(TOKEN)],
    ];
    expect(matchesDnsToken(records, TOKEN)).toBe(true);
  });

  it('accepts a bare token, which people paste more often than the full string', () => {
    expect(matchesDnsToken([[TOKEN]], TOKEN)).toBe(true);
  });

  it('tolerates the quotes and whitespace DNS UIs add', () => {
    expect(matchesDnsToken([[`  "${dnsRecordValue(TOKEN)}"  `]], TOKEN)).toBe(true);
  });

  it("rejects another site's token", () => {
    expect(matchesDnsToken([[dnsRecordValue('deadbeef')]], TOKEN)).toBe(false);
  });

  it('rejects a value that merely contains the token', () => {
    expect(matchesDnsToken([[`${dnsRecordValue(TOKEN)}-not-really`]], TOKEN)).toBe(false);
  });

  it('rejects an empty zone', () => {
    expect(matchesDnsToken([], TOKEN)).toBe(false);
  });
});

describe('matchesFileBody', () => {
  it('accepts the bare token with the trailing newline an editor adds', () => {
    expect(matchesFileBody(`${TOKEN}\n`, TOKEN)).toBe(true);
  });

  it('accepts the full key=value form, for owners who copied the DNS string', () => {
    expect(matchesFileBody(dnsRecordValue(TOKEN), TOKEN)).toBe(true);
  });

  it('rejects an HTML error page served in place of the missing file', () => {
    expect(matchesFileBody('<!doctype html><title>404</title>', TOKEN)).toBe(false);
  });

  it('rejects a file that contains the token amid other text', () => {
    expect(matchesFileBody(`token is ${TOKEN} ok`, TOKEN)).toBe(false);
  });
});

describe('hostnameOf', () => {
  it('reduces a stored site URL to its hostname', () => {
    expect(hostnameOf('https://ghorerbazar.com/')).toBe('ghorerbazar.com');
    expect(hostnameOf('https://shop.example.com/path?a=1')).toBe('shop.example.com');
  });

  it('returns a malformed domain unchanged rather than throwing in a server component', () => {
    expect(hostnameOf('not a url')).toBe('not a url');
  });
});

describe('randomToken', () => {
  it('is 32 hex characters — the shape the 0012 migration backfills', () => {
    expect(randomToken()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 200 }, randomToken));
    expect(tokens.size).toBe(200);
  });
});

describe('CRAWL_VERIFY_HEADER', () => {
  /**
   * The scraper hard-codes this name in `vps-scraper/src/crawler.ts` because
   * the workspaces don't share code. If the app's value drifts, verified
   * owners write a firewall rule for a header that never arrives — a failure
   * that looks exactly like the block it was meant to fix.
   */
  it('matches the name the scraper sends', () => {
    expect(CRAWL_VERIFY_HEADER).toBe('X-Aigenic-Verify');
  });
});
