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
import { RateLimiter } from './rate-limit.js';
import { discoverSitemapUrls } from './sitemap.js';
import { assertPublicUrl, isSsrfBlocked, safeFetch } from './ssrf-guard.js';
import { buildSite, isSameSite, normalizeUrl, shouldSkipUrl } from './url-utils.js';
import { sendWebhook, type WebhookEvent } from './webhook.js';

// Concurrency 3 is a sweet spot for Cloudflare-fronted origins: high enough to
// keep throughput up, low enough that the edge doesn't reset our connections
// for "burst" behavior. Bump it for friendlier hosts via SCRAPER_CONCURRENCY.
const CONCURRENCY = Number(process.env.SCRAPER_CONCURRENCY ?? 3);
const DEFAULT_MIN_DELAY_MS = 150;
const MAX_MIN_DELAY_MS = 5_000;

// Realistic Chrome UA. Many shop platforms (Shopify, WooCommerce) sit behind
// Cloudflare or similar WAFs that reset the TCP connection mid-handshake for
// identifiable bot User-Agents. Since we only crawl sites the tenant has
// explicitly enrolled, presenting as Chrome is the appropriate default.
// Override via SCRAPER_USER_AGENT for stricter identification requirements.
const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ??
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface CrawlJob {
  siteId: string;
  startUrl: string;
  maxPages: number;
  webhookUrl: string;
  webhookApiKey: string;
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
 */
export async function runCrawl(job: CrawlJob): Promise<void> {
  const { siteId, startUrl, maxPages, webhookUrl, webhookApiKey, generation, signal } =
    job;

  const startedAt = Date.now();
  let totalPages = 0;
  let renderedPages = 0;
  let httpPages = 0;
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
    const { robots, robotsBody } = await loadRobots(origin);

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
        ignoreHTTPSErrors: true,
        javaScriptEnabled: true,
        viewport: { width: 1280, height: 800 },
      });
      return context;
    };

    const seenUrls = new Set<string>();
    const seenHashes = new Set<string>();
    const queue: string[] = [];

    // Seed: start URL + everything we can pull from sitemaps. The sitemap
    // discovery layer also runs URLs through `normalizeUrl` / `isSameSite` /
    // `shouldSkipUrl`, so anything it hands back is safe to enqueue.
    enqueue(normalizeUrl(startUrl));

    const sitemapUrls = await discoverSitemapUrls({
      origin,
      site,
      userAgent: USER_AGENT,
      robotsBody,
    });
    for (const u of sitemapUrls) enqueue(u);

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
              return await crawlOne({ url, getContext, signal });
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
      const diagnosis = await diagnoseEmptyCrawl(startUrl, USER_AGENT);
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
  getContext: () => Promise<BrowserContext>;
  signal: AbortSignal | undefined;
}): Promise<CrawlOneResult | null> {
  const fetched = await fetchPage({
    url: opts.url,
    userAgent: USER_AGENT,
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
): Promise<{ robots: RobotsApi; robotsBody: string }> {
  const robotsUrl = `${origin}/robots.txt`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { response: res } = await safeFetch(robotsUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/plain,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
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
