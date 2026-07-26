import { safeFetch, isSsrfBlocked } from './ssrf-guard.js';
import { logger } from './logger.js';

/**
 * Why a crawl ended with zero pages, in terms the site owner can act on.
 *
 * A zero-page crawl used to report a bare `complete` and the dashboard showed
 * a green "ready" over an empty knowledge base. The single biggest real-world
 * cause is a WAF (Cloudflare bot protection and friends) serving 403 block
 * pages to every request while letting robots.txt through — so the crawl
 * "succeeds" at crawling nothing. Diagnosing here turns that silence into an
 * instruction: "allow our crawler through your firewall, then retry".
 */
export interface EmptyCrawlDiagnosis {
  code: 'blocked' | 'unreachable' | 'empty';
  message: string;
}

/** Pure classification of the probe outcome — unit-testable without network. */
export function classifyProbe(
  outcome: { status: number } | { failed: string },
): EmptyCrawlDiagnosis {
  if ('failed' in outcome) {
    return {
      code: 'unreachable',
      message: `We could not reach the site at all (${outcome.failed}). Check that the domain is correct and the site is online, then retry the crawl.`,
    };
  }

  const { status } = outcome;
  if (status === 401 || status === 403 || status === 429) {
    return {
      code: 'blocked',
      message:
        `The site's security service answered with HTTP ${status} instead of the page — ` +
        'a firewall or bot-protection layer (such as Cloudflare) is blocking our crawler. ' +
        'Please allow this app to crawl the site (e.g. an allowlist/skip rule in the firewall), then retry.',
    };
  }
  if (status >= 500) {
    return {
      code: 'unreachable',
      message: `The site responded with a server error (HTTP ${status}) on every page. Retry once the site is healthy.`,
    };
  }
  return {
    code: 'empty',
    message:
      'We could reach the site but could not extract any readable pages. ' +
      'This can happen when every page is rendered by scripts our crawler cannot run, or when robots.txt disallows all content pages.',
  };
}

/**
 * One GET of the start URL, classified. Runs only after a crawl found zero
 * pages, so its single request is negligible next to the crawl that preceded
 * it. Never throws.
 */
export async function diagnoseEmptyCrawl(
  startUrl: string,
  userAgent: string,
  /**
   * The same headers the crawl itself used. The probe has to be a faithful
   * replay: a verified site whose firewall rule matches `X-Aigenic-Verify`
   * would answer 200 to the crawl and 403 to a bare probe, and we'd report
   * "your firewall blocked us" to the one owner who had already fixed that.
   */
  extraHeaders: Record<string, string> = {},
): Promise<EmptyCrawlDiagnosis> {
  try {
    const { response } = await safeFetch(startUrl, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,*/*;q=0.8',
        ...extraHeaders,
      },
      signal: AbortSignal.timeout(15_000),
    });
    // Body content is irrelevant — the status is the diagnosis. Cancel so the
    // connection is released rather than left to drain.
    await response.body?.cancel().catch(() => undefined);
    return classifyProbe({ status: response.status });
  } catch (err) {
    const reason = err instanceof Error ? err.message.split('\n')[0]! : 'unknown error';
    if (isSsrfBlocked(err)) {
      // Shouldn't happen (the start URL was validated before the crawl), but
      // if it does, "unreachable" with the guard's reason is the honest label.
      logger.warn({ startUrl }, 'diagnose probe hit the ssrf guard');
    }
    return classifyProbe({ failed: reason });
  }
}
