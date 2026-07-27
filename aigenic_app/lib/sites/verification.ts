import { Resolver } from 'node:dns/promises';
import { isDisallowedHost } from '@/lib/http/public-url';

/**
 * Domain-ownership verification.
 *
 * The problem this solves: anyone can paste any URL into "add a site". Until
 * the person asking for a crawl has demonstrated they control the domain,
 * there is no basis for treating a block as something to work around — and no
 * basis for issuing the `X-Aigenic-Verify` secret that lets a firewall wave
 * our crawler through.
 *
 * Two methods, deliberately ordered:
 *
 *  1. **DNS TXT** — the only one that works on a site whose firewall is
 *     already refusing us, which is the exact situation verification exists
 *     to unblock. Always try this first, and lead with it in the UI.
 *  2. **Well-known file** — easier for someone who can upload a file but
 *     doesn't own the DNS zone, but it needs a successful HTTP fetch of the
 *     site, so a hard WAF block defeats it.
 *
 * Everything here is pure or does one bounded network read; nothing writes to
 * the database (that's the caller's job) so the matching rules stay testable
 * without a DB.
 */

/** Prefix on the published TXT record, so we can find ours among many. */
export const DNS_TXT_PREFIX = 'aigenic-site-verification=';

/** Subdomain we prefer for the TXT record — keeps the apex uncluttered. */
export const DNS_TXT_SUBDOMAIN = '_aigenic';

/** Path the file method reads, relative to the site's origin. */
export const WELL_KNOWN_PATH = '/.well-known/aigenic-verification.txt';

/** Header carrying the per-site `crawlSecret` on every crawl request. */
export const CRAWL_VERIFY_HEADER = 'X-Aigenic-Verify';

const DNS_TIMEOUT_MS = 4_000;
const DNS_TRIES = 2;
const FILE_TIMEOUT_MS = 8_000;
/** A verification file holds one token; anything larger is not our file. */
const FILE_MAX_BYTES = 4_096;

export type VerificationMethod = 'dns' | 'file';

export type VerificationResult =
  { ok: true; method: VerificationMethod } | { ok: false; error: string };

/** The exact string an owner pastes into their DNS TXT record. */
export function dnsRecordValue(token: string): string {
  return `${DNS_TXT_PREFIX}${token}`;
}

/**
 * Bare hostname of a stored site domain (which is always a full URL). Falls
 * back to the raw value so a malformed row renders as itself rather than
 * throwing inside a server component.
 */
export function hostnameOf(domain: string): string {
  try {
    return new URL(domain).hostname;
  } catch {
    return domain;
  }
}

/**
 * Hostnames to query, most-specific first.
 *
 * `_aigenic.<host>` is the documented spot, but people routinely put the
 * record on the apex instead, and a site registered as `www.example.com`
 * usually has its zone at `example.com`. Checking all four costs a few
 * milliseconds and saves a support round-trip; NXDOMAIN on the ones that
 * don't exist is the expected, cheap case.
 */
export function dnsCandidateHosts(hostname: string): string[] {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const bare = host.startsWith('www.') ? host.slice(4) : null;
  const candidates = [
    `${DNS_TXT_SUBDOMAIN}.${host}`,
    host,
    ...(bare ? [`${DNS_TXT_SUBDOMAIN}.${bare}`, bare] : []),
  ];
  return Array.from(new Set(candidates));
}

/**
 * Does any TXT record carry our token?
 *
 * Node hands back `string[][]`: one array per record, each split into the
 * 255-byte chunks the wire format uses. A long value published through some
 * DNS UIs arrives pre-split, so the chunks must be rejoined before comparing
 * — matching chunk-by-chunk silently fails for exactly the users whose
 * provider chunked the record.
 */
export function matchesDnsToken(records: string[][], token: string): boolean {
  const expected = dnsRecordValue(token).toLowerCase();
  return records.some((chunks) => {
    const value = chunks.join('').trim().replace(/^"|"$/g, '').toLowerCase();
    return value === expected || value === token.toLowerCase();
  });
}

/**
 * Does the fetched well-known file prove ownership? The file is expected to
 * hold the bare token; we also accept the full `key=value` form so an owner
 * who copied the DNS string into the file isn't told they got it wrong.
 */
export function matchesFileBody(body: string, token: string): boolean {
  const value = body.trim().toLowerCase();
  return value === token.toLowerCase() || value === dnsRecordValue(token).toLowerCase();
}

/**
 * Proves the caller controls `domain`, by DNS first and the well-known file
 * second. Never throws — a lookup failure is a verification failure with a
 * message the owner can act on.
 */
export async function verifyDomainOwnership(params: {
  domain: string;
  token: string;
}): Promise<VerificationResult> {
  const { domain, token } = params;

  let hostname: string;
  try {
    hostname = new URL(domain).hostname;
  } catch {
    return { ok: false, error: 'This site has an invalid domain. Fix it in Settings.' };
  }
  if (isDisallowedHost(hostname)) {
    return { ok: false, error: 'Only public domains can be verified.' };
  }

  if (await hasDnsToken(hostname, token)) return { ok: true, method: 'dns' };
  if (await hasWellKnownToken(hostname, token)) return { ok: true, method: 'file' };

  return {
    ok: false,
    error:
      "We couldn't find your verification token yet. DNS changes can take a few " +
      'minutes to propagate — check the record and try again shortly.',
  };
}

/** Queries every candidate host, tolerating the usual NXDOMAIN/timeout noise. */
async function hasDnsToken(hostname: string, token: string): Promise<boolean> {
  // A fresh resolver per call so the timeout applies to *our* lookups and we
  // never mutate the process-wide default resolver's settings.
  const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: DNS_TRIES });
  for (const candidate of dnsCandidateHosts(hostname)) {
    try {
      const records = await resolver.resolveTxt(candidate);
      if (matchesDnsToken(records, token)) return true;
    } catch {
      // ENOTFOUND/ENODATA/ETIMEOUT on one candidate says nothing about the
      // next one — only the absence of a match across all of them is a "no".
    }
  }
  return false;
}

/**
 * Reads `/.well-known/aigenic-verification.txt` over HTTPS.
 *
 * `redirect: 'error'` matters: following redirects would let a site under the
 * attacker's control point at *someone else's* hosted token, and would also
 * let this fetch be walked onto an internal address. The verification file is
 * served from the domain being claimed or it doesn't count.
 */
async function hasWellKnownToken(hostname: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(`https://${hostname}${WELL_KNOWN_PATH}`, {
      redirect: 'error',
      cache: 'no-store',
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
    });
    if (!response.ok) return false;

    const body = await readCapped(response, FILE_MAX_BYTES);
    return body !== null && matchesFileBody(body, token);
  } catch {
    return false;
  }
}

/** Reads at most `maxBytes` of a response body; null if it runs longer. */
async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let received = 0;
  let out = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        void reader.cancel();
        return null;
      }
      out += decoder.decode(value, { stream: true });
    }
    return out + decoder.decode();
  } catch {
    return null;
  }
}
