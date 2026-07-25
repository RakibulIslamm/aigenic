import type { BrowserContext } from 'playwright';
import type { Response as UndiciResponse } from 'undici';
import { logger } from './logger.js';
import { assertPublicUrl, isSsrfBlocked, safeFetch } from './ssrf-guard.js';

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
  signal: AbortSignal | undefined;
}): Promise<FetchResult | null> {
  const { url, userAgent, getContext, signal } = opts;

  if (signal?.aborted) return null;

  const httpResult = await tryHttp(url, userAgent, signal);
  if (httpResult && looksRendered(httpResult.html)) {
    return httpResult;
  }

  if (signal?.aborted) return httpResult;

  try {
    const context = await getContext();
    return await tryPlaywright(context, url, signal);
  } catch (err) {
    logger.debug(
      { url, reason: err instanceof Error ? err.message.split('\n')[0] : 'unknown' },
      'browser escalation failed',
    );
    return httpResult; // fall back to whatever HTTP gave us, even if thin
  }
}

async function tryHttp(
  url: string,
  userAgent: string,
  userSignal?: AbortSignal,
): Promise<FetchResult | null> {
  for (let attempt = 1; attempt <= HTTP_MAX_ATTEMPTS; attempt++) {
    if (userSignal?.aborted) return null;
    try {
      // `safeFetch` re-validates the host on every redirect hop, so a page
      // that 302s to 169.254.169.254 dies here rather than being ingested.
      const { response: res, finalUrl } = await safeFetch(url, {
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
        signal: combineSignals(AbortSignal.timeout(HTTP_TIMEOUT_MS), userSignal),
      });

      if (!res.ok) return null;

      const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
      if (
        !contentType.includes('text/html') &&
        !contentType.includes('application/xhtml')
      ) {
        return null;
      }

      const contentLength = Number(res.headers.get('content-length') ?? '0');
      if (contentLength > MAX_HTML_BYTES) return null;

      const html = await readBodyCapped(res.body, MAX_HTML_BYTES);
      if (html === null) return null;

      return { finalUrl, html, rendered: false };
    } catch (err) {
      // A blocked host is a verdict, not a hiccup — never retry it, and log
      // loudly enough that the block is visible in the crawl logs.
      if (isSsrfBlocked(err)) {
        logger.warn({ url, err: describe(err) }, 'ssrf-guard: blocked http fetch');
        return null;
      }
      const code = transientCode(err);
      if (attempt < HTTP_MAX_ATTEMPTS && code) {
        const backoff = HTTP_RETRY_BASE_MS * 2 ** (attempt - 1);
        logger.debug({ url, attempt, code, backoff }, 'http transient, retrying');
        await sleep(backoff);
        continue;
      }
      logger.debug(
        { url, attempt, code: code ?? (err instanceof Error ? err.name : 'unknown') },
        'http fetch gave up',
      );
      return null;
    }
  }
  return null;
}

/**
 * Returns the matching transient error code (`ECONNRESET`, `EPIPE`, etc.) if
 * the error is retryable, or null otherwise. Walks the cause chain since
 * undici wraps the underlying socket error.
 */
function transientCode(err: unknown): string | null {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === 'object'; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && TRANSIENT_ERROR_CODES.has(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** First line of an error message — pino would otherwise log a whole stack. */
function describe(err: unknown): string {
  return err instanceof Error ? (err.message.split('\n')[0] ?? err.name) : 'unknown';
}

/**
 * Combine multiple AbortSignals into one. `undefined` entries are ignored.
 * Node 20+ ships `AbortSignal.any` but we polyfill it defensively.
 */
function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const real = signals.filter((s): s is AbortSignal => s !== undefined);
  if (real.length === 0) return new AbortController().signal;
  if (real.length === 1) return real[0]!;
  if (typeof (AbortSignal as { any?: unknown }).any === 'function') {
    return (AbortSignal as { any: (s: AbortSignal[]) => AbortSignal }).any(real);
  }
  const controller = new AbortController();
  for (const s of real) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

// undici's stream type, not the DOM one — the two `ReadableStream`
// declarations aren't assignable to each other under `lib: [DOM]`.
async function readBodyCapped(
  body: UndiciResponse['body'],
  maxBytes: number,
): Promise<string | null> {
  if (!body) return null;
  const reader = body.getReader();
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
      html,
    );
  return !hasSpaShell;
}

async function tryPlaywright(
  context: BrowserContext,
  url: string,
  userSignal?: AbortSignal,
): Promise<FetchResult | null> {
  if (userSignal?.aborted) return null;

  // Chromium does its own DNS and its own redirect-following, so `safeFetch`
  // can't cover this path. We check the target before navigating and re-check
  // where we actually landed after — which catches a redirect chain that ends
  // somewhere private, even though it can't stop the request being *made*.
  // Blocking that last gap is the container's egress filter (docker-compose.yml).
  try {
    assertPublicUrl(url);
  } catch (err) {
    logger.warn({ url, err: describe(err) }, 'ssrf-guard: blocked browser navigation');
    return null;
  }

  const page = await context.newPage();
  // If the crawl is stopped mid-navigation, close the page so `page.goto` rejects.
  const onAbort = () => {
    page.close().catch(() => undefined);
  };
  userSignal?.addEventListener('abort', onAbort, { once: true });

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

    const finalUrl = page.url();
    // Post-navigation re-check: if the redirect chain ended on a private
    // host, drop the page rather than extracting an article from it.
    try {
      assertPublicUrl(finalUrl);
    } catch (err) {
      logger.warn(
        { url, finalUrl, err: describe(err) },
        'ssrf-guard: browser landed on a non-public host',
      );
      return null;
    }

    const html = await page.content();
    return { finalUrl, html, rendered: true };
  } catch (err) {
    logger.debug(
      { url, reason: err instanceof Error ? err.message.split('\n')[0] : 'unknown' },
      'playwright fetch failed',
    );
    return null;
  } finally {
    userSignal?.removeEventListener('abort', onAbort);
    await page.close().catch(() => undefined);
  }
}
