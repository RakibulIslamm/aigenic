import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import pLimit from 'p-limit';
import { logger } from './logger.js';

// robots-parser is CommonJS with a callable default export; NodeNext interop
// trips on the typings, so we pull it in with createRequire and cast.
const require = createRequire(import.meta.url);
type RobotsApi = {
  isAllowed(url: string, ua: string): boolean | undefined;
  getCrawlDelay(ua: string): number | undefined;
};
const robotsParser = require('robots-parser') as (url: string, body: string) => RobotsApi;

import { parsePage } from './content-extractor.js';
import { diagnoseEmptyCrawl } from './diagnose.js';
import { fetchPage } from './fetcher.js';
import { createOriginRoute, type OriginRoute } from './origin-route.js';
import { RateLimiter } from './rate-limit.js';
import { discoverSitemapUrls } from './sitemap.js';
import { collectStructuredDocs } from './sources/index.js';
import { assertPublicUrl, isSsrfBlocked, safeFetch } from './ssrf-guard.js';
import { buildSite, isSameSite, normalizeUrl, shouldSkipUrl } from './url-utils.js';
import { sendWebhook, type WebhookEvent } from './webhook.js';

// Concurrency 3 is a sweet spot for Cloudflare-fronted origins: high enough to
// keep throughput up, low enough that the edge doesn't reset our connections
// for "burst" behavior. Bump it for friendlier hosts via SCRAPER_CONCURRENCY.
const CONCURRENCY = Number(process.env.SCRAPER_CONCURRENCY ?? 3);
const DEFAULT_MIN_DELAY_MS = 150;
const MAX_MIN_DELAY_MS = 5_000;

/**
 * Share of the page budget structured sources may consume.
 *
 * Reserving the remainder for the HTML crawl is the whole point of the split.
 * A 1,000-product store would otherwise exhaust the budget on its catalogue
 * and never reach the About, Delivery and Returns pages — the ones support
 * questions are actually about. The reserve is a ceiling, not an allocation:
 * a site with fifty products leaves the other 950 slots to the crawl.
 */
const STRUCTURED_BUDGET_RATIO = 0.8;

// Realistic Chrome UA *plus* a product token — the crawler's public identity.
// The Chrome prefix keeps ordinary shop platforms rendering normal markup;
// the trailing `AigenicBot/1.0` is what the public `/crawler` page documents,
// and it lets robots.txt address us by name (`User-agent: AigenicBot`), which
// the robots checks below honor. Override via SCRAPER_USER_AGENT.
const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ??
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 AigenicBot/1.0';

export interface CrawlJob {
  siteId: string;
  startUrl: string;
  maxPages: number;
  webhookUrl: string;
  webhookApiKey: string;
  /**
   * `crawl.<domain>` — the hostname this crawl's requests should be sent to,
   * for a site whose owner connected their DNS provider and had us create a
   * record pointing at their origin. Applied to every request the crawl makes
   * (robots.txt, sitemaps, platform APIs, pages, and the post-mortem probe),
   * because the CDN that refuses page requests refuses those too.
   *
   * Explicitly `| undefined`: under `exactOptionalPropertyTypes` the caller
   * forwards the schema's optional field straight through, so the property is
   * present-and-undefined rather than absent.
   */
  crawlHost?: string | undefined;
  /**
   * The app's staging generation for this crawl. Echoed back on every webhook
   * so the app can route these articles into a generation nothing reads yet,
   * and can ignore our events entirely if a newer crawl has superseded us.
   */
  generation: number;
  /**
   * Optional signal used by the UI's "Stop crawling" feature. When aborted,
   * the BFS loop exits at the next batch boundary, the browser is closed
   * cleanly, and a `stopped` webhook is sent in place of `complete`.
   */
  signal?: AbortSignal;
}

/**
 * Drives a single tenant crawl: strict same-site BFS gated by robots.txt and
 * the maxPages cap. External URLs are never enqueued — the same-site guard
 * (`isSameSite`) treats `www.example.com` and `example.com` as one site but
 * rejects subdomains and any third-party host.
 *
 * Dedup happens in two layers:
 *  - URL: aggressive `normalizeUrl` (strips tracking params, sorts query,
 *    lowercases host, etc.) feeds a `seenUrls` Set; canonical-link redirects
 *    pre-claim the canonical URL.
 *  - Content: SHA-256 of extracted text feeds `seenHashes`; if the same body
 *    appears under a different URL we skip the webhook.
 *
 * Speed comes from a two-tier fetcher: plain `fetch()` first, escalate to
 * Playwright only when the HTTP body looks like a JS shell. The browser is
 * launched lazily — fully static sites never pay the Chromium startup cost.
 *
 * Before any of that, `sources/` reads whatever documented data feed the site
 * publishes (Shopify `/products.json`, the WooCommerce Store API, WordPress
 * `wp/v2`). On a catalogue site this is the difference between eleven requests
 * and a thousand, and it yields real prices and SKUs instead of Readability's
 * guesses. Those documents claim their URLs up front, so the BFS below then
 * spends its budget on what the API *didn't* cover — the About and policy
 * pages support questions are actually about.
 */
export async function runCrawl(job: CrawlJob): Promise<void> {
  const {
    siteId,
    startUrl,
    maxPages,
    webhookUrl,
    webhookApiKey,
    generation,
    crawlHost,
    signal,
  } = job;

  const startedAt = Date.now();
  let totalPages = 0;
  let renderedPages = 0;
  let httpPages = 0;
  /** Pages that came from a platform API rather than an HTML fetch. */
  let structuredPages = 0;
  let failedFetches = 0;
  let duplicateContent = 0;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  const maybeSite = buildSite(startUrl);
  if (!maybeSite) {
    await sendWebhook({
      url: webhookUrl,
      apiKey: webhookApiKey,
      payload: {
        event: 'error',
        siteId,
        generation,
        error: `Invalid start URL: ${startUrl}`,
      },
    }).catch(() => undefined);
    return;
  }
  const site = maybeSite;

  // Built once and threaded through every fetch. It is the identity route
  // unless this site has a `crawl.` record, and it refuses a crawl host that
  // isn't a subdomain of the site being crawled — see `origin-route.ts`.
  const route: OriginRoute = createOriginRoute({
    siteHostname: site.hostname,
    crawlHost,
  });
  if (route.crawlHost) {
    logger.info({ siteId, crawlHost: route.crawlHost }, 'crawling via origin route');
  }

  // Name/scheme check on the start URL up front. Blocked here means the whole
  // crawl fails with a clear reason rather than quietly producing zero pages —
  // the per-URL guards below can only skip, and a user who typed a private
  // address deserves to be told. (The DNS-level check still happens at connect
  // time for every fetch, including this host.)
  try {
    assertPublicUrl(startUrl);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'blocked start URL';
    logger.warn({ siteId, startUrl }, 'ssrf-guard: blocked start URL');
    await sendWebhook({
      url: webhookUrl,
      apiKey: webhookApiKey,
      payload: {
        event: 'error',
        siteId,
        generation,
        error: `Refusing to crawl a non-public address — ${reason}`,
      },
    }).catch(() => undefined);
    return;
  }

  try {
    const origin = new URL(startUrl).origin;
    const { robots, robotsBody } = await loadRobots(origin, route);

    if (robots.isAllowed(startUrl, USER_AGENT) === false) {
      throw new Error(`robots.txt disallows the start URL ${startUrl}`);
    }

    const robotsCrawlDelaySec = robots.getCrawlDelay(USER_AGENT);
    const minDelayMs = Math.min(
      MAX_MIN_DELAY_MS,
      Math.max(DEFAULT_MIN_DELAY_MS, Math.round((robotsCrawlDelaySec ?? 0) * 1000)),
    );
    const rateLimiter = new RateLimiter(minDelayMs);

    const getContext = async (): Promise<BrowserContext> => {
      if (context) return context;
      browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
      context = await browser.newContext({
        userAgent: USER_AGENT,
        // Required for the crawl-host route: that hostname is served by the
        // origin's own certificate, which is issued for the real domain and
        // can never match `crawl.<domain>`.
        ignoreHTTPSErrors: true,
        javaScriptEnabled: true,
        viewport: { width: 1280, height: 800 },
      });
      return context;
    };

    const seenUrls = new Set<string>();
    const seenHashes = new Set<string>();
    const queue: string[] = [];

    function enqueue(url: string | null): boolean {
      if (!url) return false;
      if (!isSameSite(url, site)) return false; // strict: never leave the site
      if (shouldSkipUrl(url)) return false;
      if (seenUrls.has(url)) return false;
      if (robots.isAllowed(url, USER_AGENT) === false) return false;
      seenUrls.add(url);
      queue.push(url);
      return true;
    }

    // Structured sources run before *anything* is queued, and the order is
    // load-bearing. `enqueue` skips URLs already in `seenUrls`, so claiming
    // them here keeps them out of the frontier entirely. Seeding the sitemap
    // first instead would put all 1,000 product URLs in the queue before the
    // API claimed them — they'd be re-fetched as HTML and only caught by the
    // content hash *after* paying for every request, which is precisely the
    // cost this module exists to avoid.
    //
    // Everything they return goes through the same dedup, budget and webhook
    // path as a crawled page; only the origin of the text differs.
    const structuredBudget = Math.floor(maxPages * STRUCTURED_BUDGET_RATIO);
    const structuredBatches = await collectStructuredDocs({
      origin,
      userAgent: USER_AGENT,
      route,
      maxDocs: structuredBudget,
      isEndpointAllowed: (url) =>
        isSameSite(url, site) && robots.isAllowed(url, USER_AGENT) !== false,
      isDocumentAllowed: (url) =>
        isSameSite(url, site) &&
        !shouldSkipUrl(url) &&
        robots.isAllowed(url, USER_AGENT) !== false,
      signal,
    });

    for (const batch of structuredBatches) {
      for (const doc of batch.docs) {
        if (signal?.aborted) break;
        if (totalPages >= maxPages) break;

        // Claim the URL so the BFS skips it. Normalizing first matters: the
        // frontier stores normalized URLs, and an unnormalized claim
        // (trailing slash, tracking param) would silently fail to match.
        const normalized = normalizeUrl(doc.url) ?? doc.url;
        if (seenUrls.has(normalized)) continue;
        seenUrls.add(normalized);

        const contentHash = hashContent(doc.content);
        if (seenHashes.has(contentHash)) {
          duplicateContent++;
          continue;
        }
        seenHashes.add(contentHash);

        totalPages++;
        structuredPages++;
        await sendWebhook({
          url: webhookUrl,
          apiKey: webhookApiKey,
          payload: {
            event: 'article',
            siteId,
            generation,
            article: {
              title: doc.title,
              content: doc.content,
              sourceUrl: normalized,
            },
          },
        }).catch((err) => {
          logger.error({ url: normalized, err }, 'webhook send failed');
        });
      }
    }

    // Seed the frontier: start URL + everything the sitemaps list. The sitemap
    // layer runs URLs through `normalizeUrl` / `isSameSite` / `shouldSkipUrl`,
    // so anything it hands back is safe to enqueue — and `enqueue` drops
    // whatever the structured pass above already covered.
    enqueue(normalizeUrl(startUrl));

    const sitemapUrls = await discoverSitemapUrls({
      origin,
      site,
      userAgent: USER_AGENT,
      route,
      robotsBody,
    });
    for (const u of sitemapUrls) enqueue(u);

    const limit = pLimit(CONCURRENCY);

    while (queue.length > 0 && totalPages < maxPages) {
      if (signal?.aborted) break;
      const remaining = maxPages - totalPages;
      const batchSize = Math.min(CONCURRENCY, remaining, queue.length);
      const batch = queue.splice(0, batchSize);

      const results = await Promise.all(
        batch.map((url) =>
          limit(async () => {
            await rateLimiter.wait(signal);
            if (signal?.aborted) return null;
            try {
              return await crawlOne({ url, route, getContext, signal });
            } catch (err) {
              logger.debug(
                {
                  url,
                  reason: err instanceof Error ? err.message.split('\n')[0] : 'unknown',
                },
                'page crawl failed',
              );
              return null;
            }
          }),
        ),
      );

      if (signal?.aborted) break;

      for (const result of results) {
        if (!result) {
          failedFetches++;
          continue;
        }
        const { article, internalLinks, finalUrl, canonical, rendered } = result;

        if (rendered) renderedPages++;
        else httpPages++;

        // Pre-claim canonical so we don't re-crawl it under a different URL.
        const canonicalNormalized =
          canonical && isSameSite(canonical, site) ? normalizeUrl(canonical) : null;
        if (canonicalNormalized) seenUrls.add(canonicalNormalized);

        // sourceUrl in the webhook: prefer the canonical when same-site,
        // otherwise the final URL after redirects.
        const sourceUrl = canonicalNormalized ?? normalizeUrl(finalUrl) ?? finalUrl;

        if (article) {
          const contentHash = hashContent(article.content);
          if (!seenHashes.has(contentHash)) {
            seenHashes.add(contentHash);
            totalPages++;
            await sendWebhook({
              url: webhookUrl,
              apiKey: webhookApiKey,
              payload: {
                event: 'article',
                siteId,
                generation,
                article: {
                  title: article.title,
                  content: article.content,
                  sourceUrl,
                },
              },
            }).catch((err) => {
              logger.error({ url: sourceUrl, err }, 'webhook send failed');
            });
          } else {
            duplicateContent++;
          }
        }

        for (const link of internalLinks) {
          enqueue(normalizeUrl(link));
        }
      }
    }

    if (context) await context.close().catch(() => undefined);

    const stopped = signal?.aborted === true;

    // A finished crawl with ZERO pages is not a success — it's a symptom
    // (WAF block, dead site, unrenderable pages). Probe once, classify, and
    // report an error the owner can act on instead of a hollow `complete`.
    if (!stopped && totalPages === 0) {
      const diagnosis = await diagnoseEmptyCrawl(startUrl, USER_AGENT, route);
      logger.warn(
        { siteId, startUrl, code: diagnosis.code, failedFetches },
        'crawl found zero pages',
      );
      await sendWebhook({
        url: webhookUrl,
        apiKey: webhookApiKey,
        payload: {
          event: 'error',
          siteId,
          generation,
          error: diagnosis.message,
          code: diagnosis.code,
        } satisfies WebhookEvent,
      });
      return;
    }

    await sendWebhook({
      url: webhookUrl,
      apiKey: webhookApiKey,
      payload: stopped
        ? ({ event: 'stopped', siteId, generation, totalPages } satisfies WebhookEvent)
        : ({ event: 'complete', siteId, generation, totalPages } satisfies WebhookEvent),
    });

    logger.info(
      {
        siteId,
        totalPages,
        uniqueUrls: seenUrls.size,
        structuredPages,
        renderedPages,
        httpPages,
        failedFetches,
        duplicateContent,
        durationMs: Date.now() - startedAt,
      },
      stopped ? 'crawl stopped' : 'crawl complete',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown crawl error';
    logger.error({ siteId, err }, 'crawl failed');
    await sendWebhook({
      url: webhookUrl,
      apiKey: webhookApiKey,
      payload: { event: 'error', siteId, generation, error: message },
    }).catch((wbErr) => {
      logger.error({ siteId, err: wbErr }, 'error-event webhook send failed');
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

interface CrawlOneResult {
  finalUrl: string;
  rendered: boolean;
  article: ReturnType<typeof parsePage>['article'];
  canonical: string | null;
  internalLinks: string[];
}

async function crawlOne(opts: {
  url: string;
  route: OriginRoute;
  getContext: () => Promise<BrowserContext>;
  signal: AbortSignal | undefined;
}): Promise<CrawlOneResult | null> {
  const fetched = await fetchPage({
    url: opts.url,
    userAgent: USER_AGENT,
    route: opts.route,
    getContext: opts.getContext,
    signal: opts.signal,
  });
  if (!fetched) return null;

  const { html, finalUrl, rendered } = fetched;
  const { article, canonical, internalLinks } = parsePage(html, finalUrl);

  return { finalUrl, rendered, article, canonical, internalLinks };
}

function hashContent(content: string): string {
  return createHash('sha256').update(content.trim().toLowerCase()).digest('hex');
}

/**
 * Fetches robots.txt exactly once per crawl and returns both the parsed API
 * and the raw body — sitemap discovery re-reads the same body for `Sitemap:`
 * lines instead of fetching robots.txt a second time.
 */
async function loadRobots(
  origin: string,
  route: OriginRoute,
): Promise<{ robots: RobotsApi; robotsBody: string }> {
  // Parsed against the canonical URL even when fetched through the crawl host:
  // every URL tested against these rules is canonical, and robots-parser
  // compares origins.
  const robotsUrl = `${origin}/robots.txt`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { response: res } = await safeFetch(robotsUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/plain,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        route,
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        const body = await res.text();
        return { robots: robotsParser(robotsUrl, body), robotsBody: body };
      }
      break; // non-ok response — don't keep retrying
    } catch (err) {
      // Never retry a blocked host, and never treat it as "no robots =
      // allow": the caller checks the start URL separately, so just stop.
      if (isSsrfBlocked(err)) {
        logger.warn({ origin }, 'ssrf-guard: blocked robots.txt fetch');
        break;
      }
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** (attempt - 1)));
        continue;
      }
      logger.debug({ origin, err }, 'robots.txt fetch failed — assuming allow');
    }
  }
  // No robots = allow everything (per RFC 9309).
  return { robots: robotsParser(robotsUrl, ''), robotsBody: '' };
}
