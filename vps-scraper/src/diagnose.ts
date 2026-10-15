import { crawlFetch, type CrawlIdentity } from './identity.js';

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
      'This can happen when every page is rendered by scripts our crawler cannot run.',
  };
}

/** What one GET of a URL looked like, before any interpretation. */
type ProbeOutcome = { status: number; challenged: boolean } | { failed: string };

/**
 * One GET with the crawl's identity. Never throws.
 *
 * `challenged` is Cloudflare's `cf-mitigated: challenge` header — the most
 * reliable sign a bot check answered instead of the site, whatever the status
 * code (the older JS challenge used to arrive as a 503).
 */
async function probeOnce(url: string, identity: CrawlIdentity): Promise<ProbeOutcome> {
  try {
    const response = await crawlFetch(url, identity, {
      headers: { Accept: 'text/html,*/*;q=0.8' },
      signal: AbortSignal.timeout(15_000),
    });
    // Body content is irrelevant — the status is the diagnosis. Cancel so the
    // connection is released rather than left to drain.
    await response.body?.cancel().catch(() => undefined);
    const challenged =
      response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge';
    return { status: response.status, challenged };
  } catch (err) {
    const reason = err instanceof Error ? err.message.split('\n')[0]! : 'unknown error';
    return { failed: reason };
  }
}

/**
 * One GET of the start URL, classified. Runs only after a crawl found zero
 * pages, so its single request is negligible next to the crawl that preceded
 * it. Never throws.
 */
export async function diagnoseEmptyCrawl(
  startUrl: string,
  identity: CrawlIdentity,
): Promise<EmptyCrawlDiagnosis> {
  const outcome = await probeOnce(startUrl, identity);
  if ('failed' in outcome) return classifyProbe(outcome);
  return classifyProbe(outcome.challenged ? { status: 403 } : { status: outcome.status });
}

export type AccessCheck =
  | { ok: true; status: number }
  | {
      ok: false;
      code: 'blocked' | 'unreachable' | 'other';
      status: number | null;
      detail: string;
    };

/** Pure classification for `checkAccess` — unit-testable without network. */
export function classifyAccess(outcome: ProbeOutcome): AccessCheck {
  if ('failed' in outcome) {
    return { ok: false, code: 'unreachable', status: null, detail: outcome.failed };
  }
  const { status, challenged } = outcome;
  if (challenged || status === 401 || status === 403 || status === 429) {
    return {
      ok: false,
      code: 'blocked',
      status,
      detail: challenged ? 'Cloudflare challenge' : `HTTP ${status}`,
    };
  }
  if (status >= 200 && status < 400) return { ok: true, status };
  if (status >= 500)
    return { ok: false, code: 'unreachable', status, detail: `HTTP ${status}` };
  return { ok: false, code: 'other', status, detail: `HTTP ${status}` };
}

/**
 * "Can the crawler get in right now?" — the dashboard's Test access button.
 * Exactly the request a crawl would make (same egress IP, User-Agent and
 * access key), so a pass here means the owner's firewall rule works.
 */
export async function checkAccess(
  url: string,
  identity: CrawlIdentity,
): Promise<AccessCheck> {
  return classifyAccess(await probeOnce(url, identity));
}
