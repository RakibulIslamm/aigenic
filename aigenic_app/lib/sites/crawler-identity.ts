/**
 * Who our crawler says it is, in one place.
 *
 * These are quoted to site owners in three places that must agree with the
 * requests they actually receive: the public `/crawler` page, the Settings
 * "Crawler access" card, and the "your firewall blocked us" panel.
 *
 * **Kept in sync with `vps-scraper/src/identity.ts`** — the workspaces don't
 * share a package, so the sync is by convention. Change one, change the other.
 */

/** Product token in the crawler's User-Agent — what owners see in their logs. */
export const CRAWLER_UA_TOKEN = 'AigenicBot';

/** The full default User-Agent, shown so an owner can match it exactly. */
export const CRAWLER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 AigenicBot/1.0';

/**
 * Header carrying the site's access key on every same-site request the
 * crawler makes. Owners allow it through their firewall with one rule.
 */
export const CRAWLER_ACCESS_HEADER = 'X-Aigenic-Access-Key';

/** Path of the public page describing the crawler. */
export const CRAWLER_DOCS_PATH = '/crawler';

/**
 * The Cloudflare rule expression matching our access key, ready to paste into
 * Security → WAF → Custom rules → "Edit expression". Cloudflare exposes
 * request headers lowercased, as arrays — hence `any(…[*] eq …)`.
 */
export function cloudflareRuleExpression(accessKey: string): string {
  return `any(http.request.headers["${CRAWLER_ACCESS_HEADER.toLowerCase()}"][*] eq "${accessKey}")`;
}

/**
 * The format the scraper accepts (`accessKeySchema` in
 * `vps-scraper/src/schemas.ts`): lowercase hex. The key travels as an HTTP
 * header value, so anything else is refused there — check before sending.
 */
export function isValidAccessKey(key: string | null | undefined): key is string {
  return typeof key === 'string' && /^[a-f0-9]{32,128}$/.test(key);
}

/** The setup guides the Crawler access card offers. */
export type Guide = 'cloudflare' | 'vercel' | 'other';

/**
 * The guide for a service name as the scraper reports it ("Cloudflare",
 * "Vercel Firewall", …). Anything we have no dedicated guide for gets the
 * generic one.
 */
export function guideForProvider(provider: string | null | undefined): Guide {
  const p = (provider ?? '').toLowerCase();
  if (p.includes('cloudflare')) return 'cloudflare';
  if (p.includes('vercel')) return 'vercel';
  return 'other';
}

/**
 * The guide to open before the owner has run a check: the service the last
 * blocked crawl named in its error ("Cloudflare answered with HTTP 403…"),
 * else Cloudflare — what most blocked sites turn out to be behind.
 */
export function initialGuideFor(lastError: string | null | undefined): Guide {
  if (!lastError) return 'cloudflare';
  const named = guideForProvider(lastError);
  if (named !== 'other') return named;
  // A known non-Cloudflare service was named → the generic guide fits.
  return /sucuri|imperva|akamai|aws/i.test(lastError) ? 'other' : 'cloudflare';
}
