/**
 * Who our crawler says it is, in one place.
 *
 * These constants are quoted verbatim on the public `/crawler` page, which is
 * what an operator reads after seeing an unfamiliar User-Agent in their logs.
 * If they drift from what the crawler actually sends, that page stops matching
 * the requests it is meant to explain.
 *
 * **Kept in sync with `USER_AGENT` in `vps-scraper/src/crawler.ts`** — the
 * workspaces don't share a package, so the sync is by convention. Change one,
 * change the other.
 */

/**
 * The product token in the crawler's User-Agent. This is the part a site owner
 * matches on, and the name robots.txt can address us by (`User-agent:
 * AigenicBot`), which the crawler honors.
 */
export const CRAWLER_UA_TOKEN = 'AigenicBot';

/** Full User-Agent string, shown so an owner can match it exactly if they want. */
export const CRAWLER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 AigenicBot/1.0';

/** Path of the public documentation page describing the crawler. */
export const CRAWLER_DOCS_PATH = '/crawler';
