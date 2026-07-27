import { isPublicAddress } from '@/lib/http/public-url';
import { hostInZone, stripWww } from '@/lib/sites/domains';
import type { DnsRecord } from '@/lib/dns/types';

/**
 * Picking the origin address out of a zone.
 *
 * Pure and dependency-free on purpose: this decides where we will point a
 * customer's new DNS record, and getting it wrong writes a bad record into
 * their live zone. It should be provable from a list of records, with no
 * network and no provider involved.
 *
 * The rules, in priority order:
 *
 *  1. An address record for the exact host the site is enrolled as.
 *  2. The zone apex — where a site's real origin nearly always lives.
 *  3. `www`, for the many zones that put the A record there and CNAME the apex.
 *
 * IPv4 beats IPv6 at every step: an origin serving both is reachable either
 * way, and an origin with a stale AAAA is a real and common misconfiguration
 * that would silently produce an unreachable crawl host.
 */

export interface OriginCandidate {
  address: string;
  type: 'A' | 'AAAA';
  /** The record name the address came from, for the "we found …" line. */
  source: string;
}

export type OriginDetection =
  | { ok: true; origin: OriginCandidate }
  | { ok: false; reason: OriginFailureReason; message: string };

export type OriginFailureReason =
  /** Only CNAMEs / ALIASes — the origin address isn't in this zone. */
  | 'aliased'
  /** Address records exist but all point somewhere non-public. */
  | 'non_public'
  /** Nothing usable at all. */
  | 'missing';

/**
 * Finds the address `crawl.<domain>` should point at.
 *
 * `excludeName` keeps a previously-created crawl record out of the running.
 * Without it, re-running after an origin change would rediscover our own
 * record and pin the old address forever.
 */
export function detectOrigin(params: {
  records: readonly DnsRecord[];
  siteHost: string;
  zoneName: string;
  excludeName?: string;
}): OriginDetection {
  const { records, siteHost, zoneName } = params;
  const exclude = params.excludeName?.toLowerCase() ?? null;
  const host = siteHost.toLowerCase();
  const apex = zoneName.toLowerCase();
  const bare = stripWww(host);

  const preference = dedupe([host, bare, apex, `www.${apex}`]);

  const addressRecords = records.filter(
    (record) =>
      (record.type === 'A' || record.type === 'AAAA') &&
      record.name.toLowerCase() !== exclude,
  );

  let sawNonPublic = false;

  for (const wanted of preference) {
    for (const type of ['A', 'AAAA'] as const) {
      const match = addressRecords.find(
        (record) => record.type === type && record.name.toLowerCase() === wanted,
      );
      if (!match) continue;
      const address = match.value.trim();
      if (!isPublicAddress(address)) {
        // A private address here is not a crawlable origin — pointing our
        // record at 10.x would make every crawl fail at connect time, and the
        // scraper's SSRF guard would refuse it anyway.
        sawNonPublic = true;
        continue;
      }
      return { ok: true, origin: { address, type, source: match.name } };
    }
  }

  if (sawNonPublic) {
    return {
      ok: false,
      reason: 'non_public',
      message:
        "Your zone's address records point at private addresses, which we can't reach from the internet. " +
        'Point the crawl record at your public origin manually, or contact support.',
    };
  }

  const hasAlias = records.some(
    (record) =>
      (record.type === 'CNAME' || record.type === 'ALIAS' || record.type === 'ANAME') &&
      preference.includes(record.name.toLowerCase()),
  );
  if (hasAlias) {
    return {
      ok: false,
      reason: 'aliased',
      message:
        `${host} is a CNAME rather than a direct address, so this zone doesn't hold your origin IP. ` +
        'Add an A record for your origin (or create crawl.' +
        bare +
        ' by hand pointing at it), then try again.',
    };
  }

  return {
    ok: false,
    reason: 'missing',
    message:
      `We couldn't find an A or AAAA record for ${host} in the ${zoneName} zone. ` +
      'Check that this is the zone serving your site.',
  };
}

/**
 * Guards the zone a caller picked against the site it claims to serve. A zone
 * id arrives from a browser form, so "the site's host is inside this zone" has
 * to be re-established on the server — otherwise a crafted request could write
 * a `crawl.` record into any other zone the connected account holds.
 */
export function zoneCoversHost(zoneName: string, siteHost: string): boolean {
  return hostInZone(stripWww(siteHost), zoneName) || hostInZone(siteHost, zoneName);
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.toLowerCase())));
}
