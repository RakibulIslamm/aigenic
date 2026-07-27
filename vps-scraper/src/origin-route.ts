import { logger } from './logger.js';

/**
 * Where a crawl's requests actually go.
 *
 * Most crawls answer "the site's own hostname", and for those this module is a
 * pair of identity functions. The interesting case is a site whose owner
 * connected their DNS provider through the dashboard: we created
 * `crawl.<domain>` pointing straight at their origin, unproxied, and this is
 * what makes the crawler fetch through it.
 *
 * **The rewrite happens at the moment of fetching and nowhere else.** The
 * frontier, the dedup sets, robots.txt matching, the same-site guard and the
 * `sourceUrl` we report back all stay in canonical space — `example.com`, the
 * URL a visitor would use and the one the assistant should cite. Only the
 * socket goes somewhere different. Rewriting earlier would leak
 * `crawl.example.com` into the knowledge base and into the same-site check,
 * which treats it as a *different* site and would have refused every link.
 *
 * The crawl host must be a subdomain of the site being crawled. That is not a
 * formality: without it, a caller holding the scraper's API key could route
 * a crawl of one domain through a hostname they control, and the pages that
 * came back would be filed under someone else's site.
 */

export interface RoutedTarget {
  /** The URL to actually request. */
  url: string;
  /**
   * True when the request goes to the crawl host. Its TLS certificate is the
   * origin's, issued for the real domain, so it cannot match `crawl.<domain>`
   * — the mismatch is expected and verifying it would fail every request.
   * Never set for requests going anywhere else.
   */
  insecureTls: boolean;
}

export interface OriginRoute {
  /** The crawl hostname in use, or null for a direct crawl. */
  readonly crawlHost: string | null;
  /** Canonical URL → the URL to fetch. */
  resolve(url: string): RoutedTarget;
  /** Crawl-host URL → canonical URL. Identity for everything else. */
  toCanonical(url: string): string;
}

const DIRECT_ROUTE: OriginRoute = {
  crawlHost: null,
  resolve: (url) => ({ url, insecureTls: false }),
  toCanonical: (url) => url,
};

export function createOriginRoute(params: {
  /** The site's hostname with `www.` stripped, as `buildSite` produces it. */
  siteHostname: string;
  crawlHost?: string | undefined;
}): OriginRoute {
  const siteHostname = params.siteHostname.toLowerCase().replace(/\.$/, '');
  const crawlHost = params.crawlHost?.trim().toLowerCase().replace(/\.$/, '');

  if (!crawlHost) return DIRECT_ROUTE;

  if (!crawlHost.endsWith(`.${siteHostname}`)) {
    // Refusing rather than throwing: a mismatched crawl host is a
    // configuration error, and a normal crawl is a strictly better outcome
    // than no crawl at all.
    logger.warn(
      { crawlHost, siteHostname },
      'origin-route: crawl host is not a subdomain of the site — crawling directly',
    );
    return DIRECT_ROUTE;
  }

  return {
    crawlHost,

    resolve(url) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { url, insecureTls: false };
      }
      if (stripWww(parsed.hostname.toLowerCase()) !== siteHostname) {
        return { url, insecureTls: false };
      }
      parsed.hostname = crawlHost;
      return { url: parsed.toString(), insecureTls: true };
    },

    toCanonical(url) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return url;
      }
      if (parsed.hostname.toLowerCase() !== crawlHost) return url;
      parsed.hostname = siteHostname;
      return parsed.toString();
    },
  };
}

function stripWww(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host;
}
