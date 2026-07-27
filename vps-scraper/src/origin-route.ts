import dnsPromises from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { Agent, type Dispatcher } from 'undici';
import { logger } from './logger.js';
import { isPublicAddress } from './ssrf-guard.js';

/**
 * Where a crawl's requests actually go.
 *
 * Most crawls answer "straight at the site", and for those this module does
 * nothing. The interesting case is a site whose owner connected their DNS
 * provider: we created `crawl.<domain>` pointing at their origin, unproxied,
 * and this is what makes the crawler reach the origin instead of the CDN
 * that's refusing it.
 *
 * **The override is on address resolution only — never on the URL.** The
 * request still says `https://example.com/`, with `Host: example.com` and
 * `example.com` in the TLS SNI; only the IP it dials comes from the crawl
 * record. This is the `curl --resolve` pattern, and the reason for it is not
 * cosmetic:
 *
 *  - **SNI decides the vhost on nearly every shared host.** Dialling the
 *    origin with `crawl.<domain>` in SNI makes managed hosts (Hostinger,
 *    cPanel, Plesk, most LiteSpeed setups) abort the TLS handshake outright —
 *    *before* presenting a certificate, so `ignoreHTTPSErrors` cannot rescue
 *    it. The ones that don't abort serve their default vhost instead, which is
 *    a parking page rather than the customer's site.
 *  - **`Host` decides which site the origin serves.** An origin asked for
 *    `crawl.example.com` has no vhost by that name.
 *  - Everything downstream — the frontier, dedup, robots matching, the
 *    same-site guard, the `sourceUrl` stored in the knowledge base — keeps
 *    working on real URLs, with nothing to translate back.
 *
 * The crawl host must be a subdomain of the site being crawled. That is not a
 * formality: without it, a caller holding the scraper's API key could pin one
 * tenant's crawl to an address they control, and the pages that came back
 * would be filed under someone else's site.
 */

export interface OriginRoute {
  /** The crawl hostname whose address we resolved, or null for a direct crawl. */
  readonly crawlHost: string | null;
  /** Addresses the origin was resolved to. Empty for a direct crawl. */
  readonly addresses: readonly string[];
  /**
   * The dispatcher to use for this URL, or null to use the default guarded
   * agent. Non-null only for the site's own hostnames.
   */
  dispatcherFor(url: string): Dispatcher | null;
  /**
   * The same override expressed as Chromium's `--host-resolver-rules` flag, so
   * the Playwright tier reaches the same origin the HTTP tier did. Null when
   * there's nothing to override.
   */
  hostResolverRules(): string | null;
  /** Releases the pinned connection pool. Safe to call on a direct route. */
  close(): Promise<void>;
}

export const DIRECT_ROUTE: OriginRoute = {
  crawlHost: null,
  addresses: [],
  dispatcherFor: () => null,
  hostResolverRules: () => null,
  close: async () => undefined,
};

/**
 * Resolves the crawl host and builds the route. Never throws: a crawl record
 * that has been deleted, hasn't propagated, or points somewhere non-public
 * degrades to a normal crawl, which is a strictly better outcome than no crawl.
 */
export async function createOriginRoute(params: {
  /** The site's hostname with `www.` stripped, as `buildSite` produces it. */
  siteHostname: string;
  crawlHost?: string | undefined;
  /** Injectable for tests; defaults to a real DNS lookup. */
  resolve?: (hostname: string) => Promise<string[]>;
}): Promise<OriginRoute> {
  const siteHostname = params.siteHostname.toLowerCase().replace(/\.$/, '');
  const crawlHost = params.crawlHost?.trim().toLowerCase().replace(/\.$/, '');

  if (!crawlHost) return DIRECT_ROUTE;

  if (!crawlHost.endsWith(`.${siteHostname}`)) {
    logger.warn(
      { crawlHost, siteHostname },
      'origin-route: crawl host is not a subdomain of the site — crawling directly',
    );
    return DIRECT_ROUTE;
  }

  let resolved: string[];
  try {
    resolved = await (params.resolve ?? resolveHost)(crawlHost);
  } catch (err) {
    logger.warn(
      { crawlHost, err: err instanceof Error ? err.message : 'unknown' },
      'origin-route: could not resolve crawl host — crawling directly',
    );
    return DIRECT_ROUTE;
  }

  // The address comes out of a customer's DNS zone, so it is exactly as
  // untrusted as a hostname they typed. Pinning to 169.254.169.254 would make
  // the crawler read this box's cloud metadata and file it as an article.
  const addresses = resolved.filter((address) => isPublicAddress(address));
  if (addresses.length === 0) {
    logger.warn(
      { crawlHost, resolved },
      'origin-route: crawl host resolves to no public address — crawling directly',
    );
    return DIRECT_ROUTE;
  }

  /** The names whose resolution we override: the apex and its `www` form. */
  const pinned = new Set([siteHostname, `www.${siteHostname}`]);

  const pinnedLookup: LookupFunction = (hostname, options, callback) => {
    // Belt and braces. `dispatcherFor` already gates this agent to the pinned
    // names; if some future call site gets that wrong, an unrelated host must
    // still not be silently sent to the customer's origin.
    if (!pinned.has(hostname.toLowerCase())) {
      callback(new Error(`origin-route: refusing to pin ${hostname}`), '', 0);
      return;
    }
    const entries = addresses.map((address) => ({
      address,
      family: address.includes(':') ? 6 : 4,
    }));
    if (options.all) {
      callback(null, entries);
      return;
    }
    const first = entries[0]!;
    callback(null, first.address, first.family);
  };

  /**
   * Certificate verification is off for these connections. With the real
   * hostname in SNI the origin usually presents a valid certificate — but
   * Cloudflare-fronted sites commonly use a Cloudflare Origin CA certificate,
   * which is deliberately not publicly trusted, and rejecting those would fail
   * exactly the setups this feature exists for. The DNS-level protection is
   * unchanged: this pool can only dial the addresses validated above.
   */
  const dispatcher = new Agent({
    connect: { lookup: pinnedLookup, rejectUnauthorized: false },
  });

  logger.info({ crawlHost, addresses }, 'origin-route: pinned site to origin');

  return {
    crawlHost,
    addresses,

    dispatcherFor(url) {
      try {
        return pinned.has(new URL(url).hostname.toLowerCase()) ? dispatcher : null;
      } catch {
        return null;
      }
    },

    hostResolverRules() {
      const target = addresses[0]!;
      // Chromium wants IPv6 literals bracketed in a MAP rule.
      const literal = target.includes(':') ? `[${target}]` : target;
      return [...pinned].map((host) => `MAP ${host} ${literal}`).join(',');
    },

    async close() {
      await dispatcher.close().catch(() => undefined);
    },
  };
}

/** A/AAAA for the crawl host, IPv4 first — an origin's v4 address is the one that works. */
async function resolveHost(hostname: string): Promise<string[]> {
  const [v4, v6] = await Promise.all([
    dnsPromises.resolve4(hostname).catch(() => [] as string[]),
    dnsPromises.resolve6(hostname).catch(() => [] as string[]),
  ]);
  return [...v4, ...v6];
}
