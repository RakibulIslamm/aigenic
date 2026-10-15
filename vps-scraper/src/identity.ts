import { isSameSite, type NormalizedSite } from './url-utils.js';

/**
 * Who the crawler says it is, and the credential it presents.
 *
 * Bot protection (Cloudflare and friends) can't be beaten reliably, and we
 * don't try: the sites we crawl belong to the customer who asked for the
 * crawl, so the dependable fix is for that customer to *let us in*. Two
 * things make that a one-rule job for them:
 *
 *  - **A per-site access key** sent as {@link ACCESS_KEY_HEADER}. The owner
 *    copies it from the dashboard and adds one firewall rule: "skip bot
 *    protection when this header equals this value". Unlike an IP rule it
 *    survives the VPS changing address, and unlike a User-Agent rule it can't
 *    be satisfied by anyone who reads our docs — only we and the owner know
 *    the value.
 *  - **An honest User-Agent token** (`AigenicBot`), so the requests are
 *    recognisable in firewall logs and robots.txt can address us by name.
 *
 * Kept byte-identical to `CRAWLER_ACCESS_HEADER` / `CRAWLER_UA_TOKEN` in the
 * app (`aigenic_app/lib/sites/crawler-identity.ts`); the workspaces don't
 * share code, so the sync is by convention.
 */
export const ACCESS_KEY_HEADER = 'X-Aigenic-Access-Key';

/** Product token in the User-Agent — what a site owner sees in their logs. */
export const CRAWLER_UA_TOKEN = 'AigenicBot';

/**
 * Desktop Chrome plus our product token. The Chrome prefix keeps ordinary shop
 * platforms serving their normal markup (some degrade or challenge anything
 * that looks like a bare bot); the trailing token is the honest part. Override
 * via SCRAPER_USER_AGENT — empty (as docker-compose passes when unset) falls
 * back to this default.
 */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 AigenicBot/1.0';

export interface CrawlIdentity {
  userAgent: string;
  /**
   * Identity headers for one request: always the User-Agent, plus the access
   * key when — and only when — `url` is on the site being crawled.
   *
   * The same-site check is the point. A crawl also touches hosts the owner
   * doesn't control (sitemap indexes listing a CDN, a `Sitemap:` line in
   * robots.txt pointing elsewhere), and the key must never reach them: it's a
   * firewall bypass for the owner's site, and a third party holding it could
   * use it.
   */
  headersFor(url: string): Record<string, string>;
  /** Whether `url` should carry the access key — see `headersFor`. */
  carriesKey(url: string): boolean;
  /** The key itself, for the browser tier's per-request header injection. */
  accessKey: string | undefined;
}

export function createCrawlIdentity(opts: {
  site: NormalizedSite;
  accessKey?: string | undefined;
  userAgent?: string | undefined;
}): CrawlIdentity {
  const userAgent = opts.userAgent || DEFAULT_USER_AGENT;
  const { accessKey, site } = opts;
  const carriesKey = (url: string) => Boolean(accessKey) && isSameSite(url, site);
  return {
    userAgent,
    accessKey,
    carriesKey,
    headersFor(url) {
      const headers: Record<string, string> = { 'User-Agent': userAgent };
      if (accessKey && carriesKey(url)) headers[ACCESS_KEY_HEADER] = accessKey;
      return headers;
    },
  };
}

const MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * `fetch` with the crawl's identity, following redirects itself.
 *
 * Built-in `redirect: 'follow'` would carry every request header to wherever
 * the site redirects — including the access key to a third-party host (a blog
 * that 301s to Medium, a "shop" link that bounces to a payments page).
 * Following hops here lets each one get its own `headersFor` verdict, so the
 * key only ever reaches the site it unlocks.
 *
 * `init.headers` are merged under the identity headers on every hop. Returns
 * the final response; its `url` is the last hop's, as with `follow`.
 */
export async function crawlFetch(
  url: string,
  identity: CrawlIdentity,
  init: { headers?: Record<string, string>; signal?: AbortSignal | undefined } = {},
): Promise<Response> {
  let current = url;
  for (let hop = 0; ; hop++) {
    const response = await fetch(current, {
      headers: { ...init.headers, ...identity.headersFor(current) },
      redirect: 'manual',
      ...(init.signal ? { signal: init.signal } : {}),
    });
    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.has(response.status) || !location) return response;
    if (hop >= MAX_REDIRECTS) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Too many redirects starting from ${url}`);
    }
    await response.body?.cancel().catch(() => undefined);
    current = new URL(location, current).toString();
  }
}
