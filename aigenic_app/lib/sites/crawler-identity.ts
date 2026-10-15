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
