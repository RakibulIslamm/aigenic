import { createRequire } from 'node:module';
import { chromium, type Browser } from 'playwright';
import pLimit from 'p-limit';
import { logger } from './logger.js';

// robots-parser is CommonJS with a callable default export; NodeNext interop
// trips on the typings, so we pull it in with createRequire and cast.
const require = createRequire(import.meta.url);
const robotsParser = require('robots-parser') as (
  url: string,
  body: string
) => { isAllowed(url: string, ua: string): boolean | undefined };
import { extractContent, extractInternalLinks } from './content-extractor.js';
import { discoverSitemapUrls } from './sitemap.js';
import { sendWebhook, type WebhookEvent } from './webhook.js';

const CONCURRENCY = 3;
const PAGE_TIMEOUT_MS = 30_000;
const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ??
  'AgentDeskBot/0.1 (+https://agentdesk.app/bot)';

export interface CrawlJob {
  siteId: string;
  startUrl: string;
  maxPages: number;
  webhookUrl: string;
  webhookApiKey: string;
}

/**
 * Drives a single tenant crawl: same-origin BFS with concurrency 3, gated by
 * robots.txt and the maxPages cap. Each successfully extracted page is
 * streamed back as an `article` webhook event; the final `complete` event
 * tells the AgentDesk app to flip the site's kb_status to 'ready'.
 */
export async function runCrawl(job: CrawlJob): Promise<void> {
  const { siteId, startUrl, maxPages, webhookUrl, webhookApiKey } = job;

  const startedAt = Date.now();
  let totalPages = 0;
  let browser: Browser | undefined;

  try {
    const origin = new URL(startUrl).origin;
    const robots = await loadRobots(origin);

    if (!robots.isAllowed(startUrl, USER_AGENT)) {
      throw new Error(`robots.txt disallows the start URL ${startUrl}`);
    }

    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
      viewport: { width: 1280, height: 800 },
    });

    const visited = new Set<string>();
    const queue: string[] = [normalizeUrl(startUrl)];
    const queueSet = new Set<string>(queue);
    const limit = pLimit(CONCURRENCY);

    // Seed the frontier with every URL we can discover from sitemap.xml +
    // sitemap_index.xml + robots.txt. This is what turns a 5-page crawl of an
    // e-commerce homepage into a full product-catalog crawl.
    const sitemapUrls = await discoverSitemapUrls({ origin, userAgent: USER_AGENT });
    for (const u of sitemapUrls) {
      const n = normalizeUrl(u);
      if (!queueSet.has(n)) {
        queue.push(n);
        queueSet.add(n);
      }
    }

    while (queue.length > 0 && visited.size < maxPages) {
      const batchSize = Math.min(
        CONCURRENCY,
        maxPages - visited.size,
        queue.length
      );
      const batch: string[] = [];
      while (batch.length < batchSize && queue.length > 0) {
        const next = queue.shift()!;
        if (visited.has(next)) continue;
        if (!robots.isAllowed(next, USER_AGENT)) {
          logger.debug({ url: next }, 'robots.txt disallows — skipping');
          continue;
        }
        visited.add(next);
        batch.push(next);
      }

      if (batch.length === 0) continue;

      const results = await Promise.all(
        batch.map((url) =>
          limit(async () => {
            try {
              return await crawlOne(context, url);
            } catch (err) {
              logger.warn({ url, err }, 'page crawl failed');
              return null;
            }
          })
        )
      );

      for (const result of results) {
        if (!result) continue;
        const { article, internalLinks } = result;

        if (article) {
          totalPages++;
          await sendWebhook({
            url: webhookUrl,
            apiKey: webhookApiKey,
            payload: {
              event: 'article',
              siteId,
              article: {
                title: article.title,
                content: article.content,
                sourceUrl: result.url,
              },
            },
          }).catch((err) => {
            logger.error({ url: result.url, err }, 'webhook send failed');
          });
        }

        for (const link of internalLinks) {
          const normalized = normalizeUrl(link);
          if (visited.has(normalized) || queueSet.has(normalized)) continue;
          queue.push(normalized);
          queueSet.add(normalized);
        }
      }
    }

    await context.close();

    await sendWebhook({
      url: webhookUrl,
      apiKey: webhookApiKey,
      payload: { event: 'complete', siteId, totalPages } satisfies WebhookEvent,
    });

    logger.info(
      { siteId, totalPages, visited: visited.size, durationMs: Date.now() - startedAt },
      'crawl complete'
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown crawl error';
    logger.error({ siteId, err }, 'crawl failed');
    await sendWebhook({
      url: webhookUrl,
      apiKey: webhookApiKey,
      payload: { event: 'error', siteId, error: message },
    }).catch((wbErr) => {
      logger.error({ siteId, err: wbErr }, 'error-event webhook send failed');
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

async function crawlOne(
  context: Awaited<ReturnType<Browser['newContext']>>,
  url: string
): Promise<{
  url: string;
  article: ReturnType<typeof extractContent>;
  internalLinks: string[];
}> {
  const page = await context.newPage();
  try {
    const response = await page.goto(url, {
      timeout: PAGE_TIMEOUT_MS,
      waitUntil: 'domcontentloaded',
    });

    if (!response) {
      return { url, article: null, internalLinks: [] };
    }

    const contentType = response.headers()['content-type'] ?? '';
    if (!contentType.includes('text/html')) {
      return { url, article: null, internalLinks: [] };
    }

    const status = response.status();
    if (status >= 400) {
      return { url, article: null, internalLinks: [] };
    }

    // Give SPAs a beat to render — short timeout, doesn't block forever.
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);

    const html = await page.content();
    const finalUrl = page.url();
    const article = extractContent(html, finalUrl);
    const internalLinks = extractInternalLinks(html, finalUrl);

    return { url: finalUrl, article, internalLinks };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function loadRobots(origin: string) {
  const robotsUrl = `${origin}/robots.txt`;
  try {
    const res = await fetch(robotsUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const body = await res.text();
      return robotsParser(robotsUrl, body);
    }
  } catch (err) {
    logger.debug({ origin, err }, 'robots.txt fetch failed — assuming allow');
  }
  // No robots = allow everything (per RFC 9309).
  return robotsParser(robotsUrl, '');
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}
