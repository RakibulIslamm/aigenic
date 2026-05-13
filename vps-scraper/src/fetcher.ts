import type { BrowserContext } from 'playwright';
import { logger } from './logger.js';

const HTTP_TIMEOUT_MS = 15_000;
const PAGE_TIMEOUT_MS = 30_000;
const NETWORK_IDLE_TIMEOUT_MS = 5_000;
const MIN_TEXT_LEN_FOR_HTTP = 400;
const MAX_HTML_BYTES = 5_000_000;
const HTTP_MAX_ATTEMPTS = 3;
const HTTP_RETRY_BASE_MS = 500;

const TRANSIENT_ERROR_CODES = new Set([
  'EPIPE',
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

export interface FetchResult {
  finalUrl: string;
  html: string;
  /** True when we had to escalate to the headless browser. */
  rendered: boolean;
}

/**
 * Two-tier page fetcher.
 *
 * 1. Try a plain HTTP `fetch()` with redirect-follow. If we get HTML and the
 *    visible-text length looks meaningful (or there are no SPA shell markers),
 *    we return it. Most static / SSR pages stop here — ~10–30× faster than
 *    spawning a Chromium page.
 * 2. Otherwise escalate to Playwright. The browser context is provided by the
 *    caller and is created lazily — if every page in a crawl can be served
 *    from HTTP, the browser is never launched.
 */
export async function fetchPage(opts: {
  url: string;
  userAgent: string;
  getContext: () => Promise<BrowserContext>;
}): Promise<FetchResult | null> {
  const { url, userAgent, getContext } = opts;

  const httpResult = await tryHttp(url, userAgent);
  if (httpResult && looksRendered(httpResult.html)) {
    return httpResult;
  }

  try {
    const context = await getContext();
    return await tryPlaywright(context, url);
  } catch (err) {
    logger.warn({ url, err }, 'browser escalation failed');
    return httpResult; // fall back to whatever HTTP gave us, even if thin
  }
}

async function tryHttp(url: string, userAgent: string): Promise<FetchResult | null> {
  for (let attempt = 1; attempt <= HTTP_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': userAgent,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });

      if (!res.ok) return null;

      const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return null;
      }

      const contentLength = Number(res.headers.get('content-length') ?? '0');
      if (contentLength > MAX_HTML_BYTES) return null;

      const html = await readBodyCapped(res, MAX_HTML_BYTES);
      if (html === null) return null;

      return { finalUrl: res.url, html, rendered: false };
    } catch (err) {
      if (attempt < HTTP_MAX_ATTEMPTS && isTransientError(err)) {
        const backoff = HTTP_RETRY_BASE_MS * 2 ** (attempt - 1);
        logger.debug({ url, attempt, backoff, err }, 'http fetch transient — retrying');
        await sleep(backoff);
        continue;
      }
      logger.debug({ url, attempt, err }, 'http fetch failed');
      return null;
    }
  }
  return null;
}

function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  // Walk the cause chain — undici wraps the underlying socket error.
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === 'object'; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && TRANSIENT_ERROR_CODES.has(code)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBodyCapped(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let received = 0;
  let out = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        reader.cancel().catch(() => undefined);
        return null;
      }
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return out;
  } catch {
    return null;
  }
}

/**
 * Heuristic: does this HTML have enough visible text to use as-is, or is it
 * a JS-shell that needs the headless browser? Cheap regex-based — we re-parse
 * with JSDOM downstream anyway.
 */
function looksRendered(html: string): boolean {
  const visibleText = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (visibleText.length >= MIN_TEXT_LEN_FOR_HTTP) return true;

  // Thin body: only escalate if there are clear SPA shell markers. Otherwise
  // it's just a short page and Playwright won't add anything.
  const hasSpaShell =
    /__NEXT_DATA__|__NUXT__|__INITIAL_STATE__|window\.__data|id=["']root["']|id=["']app["']|id=["']__next["']/i.test(
      html
    );
  return !hasSpaShell;
}

async function tryPlaywright(
  context: BrowserContext,
  url: string
): Promise<FetchResult | null> {
  const page = await context.newPage();
  try {
    const response = await page.goto(url, {
      timeout: PAGE_TIMEOUT_MS,
      waitUntil: 'domcontentloaded',
    });

    if (!response) return null;

    const contentType = (response.headers()['content-type'] ?? '').toLowerCase();
    if (!contentType.includes('text/html')) return null;

    if (response.status() >= 400) return null;

    await page
      .waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS })
      .catch(() => undefined);

    const html = await page.content();
    const finalUrl = page.url();
    return { finalUrl, html, rendered: true };
  } catch (err) {
    logger.warn({ url, err }, 'playwright fetch failed');
    return null;
  } finally {
    await page.close().catch(() => undefined);
  }
}
