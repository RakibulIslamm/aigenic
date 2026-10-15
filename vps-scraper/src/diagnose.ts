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

/**
 * Which edge/security service answered, from the response headers it stamps on
 * everything — so the owner is told "Vercel Firewall blocked us", not handed
 * Cloudflare instructions for a site that isn't on Cloudflare. Null when the
 * response carries no recognisable signature (the origin's own server or a
 * WordPress security plugin, which only shows itself in the body).
 */
export function detectProtection(headers: Headers): string | null {
  const server = (headers.get('server') ?? '').toLowerCase();
  if (headers.has('cf-ray') || server === 'cloudflare') return 'Cloudflare';
  if (
    headers.has('x-vercel-id') ||
    headers.has('x-vercel-mitigated') ||
    server === 'vercel'
  ) {
    return 'Vercel Firewall';
  }
  if (headers.has('x-sucuri-id') || server.includes('sucuri')) return 'Sucuri';
  if (
    headers.has('x-iinfo') ||
    (headers.get('x-cdn') ?? '').toLowerCase().includes('incapsula')
  ) {
    return 'Imperva';
  }
  if (server.includes('akamaighost')) return 'Akamai';
  if (headers.has('x-amz-cf-id')) return 'AWS CloudFront / AWS WAF';
  return null;
}

/**
 * A bot check answered instead of the site, whatever the status code:
 * Cloudflare's `cf-mitigated: challenge` (its older JS challenge arrived as a
 * 503) and Vercel's `x-vercel-mitigated: challenge | deny`.
 */
export function isChallenge(headers: Headers): boolean {
  return (
    headers.get('cf-mitigated')?.toLowerCase() === 'challenge' ||
    headers.has('x-vercel-mitigated')
  );
}

/** Pure classification of the probe outcome — unit-testable without network. */
export function classifyProbe(
  outcome: { status: number; provider?: string | null } | { failed: string },
): EmptyCrawlDiagnosis {
  if ('failed' in outcome) {
    return {
      code: 'unreachable',
      message: `We could not reach the site at all (${outcome.failed}). Check that the domain is correct and the site is online, then retry the crawl.`,
    };
  }

  const { status, provider } = outcome;
  if (status === 401 || status === 403 || status === 429) {
    return {
      code: 'blocked',
      message: provider
        ? `${provider} answered with HTTP ${status} instead of the page — its bot protection is blocking our crawler. ` +
          'Please allow this app to crawl the site (one allow rule for our access key), then retry.'
        : `The site answered with HTTP ${status} instead of the page — a firewall, security plugin or the host is blocking our crawler. ` +
          'Please allow this app to crawl the site (one allow rule for our access key), then retry.',
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
type ProbeOutcome =
  { status: number; challenged: boolean; provider: string | null } | { failed: string };

/**
 * One GET with the crawl's identity, plus who answered it. Never throws.
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
    return {
      status: response.status,
      challenged: isChallenge(response.headers),
      provider: detectProtection(response.headers),
    };
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
  return classifyProbe({
    status: outcome.challenged ? 403 : outcome.status,
    provider: outcome.provider,
  });
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
  const { status, challenged, provider } = outcome;
  if (challenged || status === 401 || status === 403 || status === 429) {
    const what = challenged ? 'bot challenge' : `HTTP ${status}`;
    return {
      ok: false,
      code: 'blocked',
      status,
      detail: provider ? `${provider} ${what}` : what,
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
