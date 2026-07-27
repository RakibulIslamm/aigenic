import dns from 'node:dns';
import type { LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from 'undici';
import { logger } from './logger.js';
import type { OriginRoute } from './origin-route.js';

/**
 * SSRF guard for every outbound request the crawler makes.
 *
 * The crawler fetches URLs a tenant typed into a form, so without this the
 * VPS is a general-purpose proxy into its own network: `http://127.0.0.1:…`,
 * `http://10.x`, and above all the cloud metadata endpoint
 * `http://169.254.169.254/` — whose response would be ingested as an
 * "article" and then read back out through the support widget.
 *
 * Three checks, each closing a hole the others leave:
 *
 *  1. **Name check** — reject bare / `.local` / `.internal` names and
 *     non-public IP literals before any DNS traffic.
 *  2. **Address check at connect time** — the `lookup` hook below runs inside
 *     the socket connect, so the address it validates is the address actually
 *     dialed. Validating a resolved list *before* calling fetch would leave a
 *     DNS-rebinding window (resolve public, re-resolve private).
 *  3. **Per-hop redirect check** — `redirect: 'manual'` plus a re-run of the
 *     whole guard on each `Location`. With `redirect: 'follow'` a public host
 *     could 302 straight to the metadata IP.
 *
 * Not covered here: Playwright's own navigation stack (see `fetcher.ts`,
 * which validates before and after `page.goto`) and subresource requests
 * Chromium makes on its own. The backstop for those is egress filtering on
 * the container — see the note in `docker-compose.yml`.
 */

/** Redirect hops followed manually before giving up. */
const MAX_REDIRECTS = 5;

/**
 * Hostname suffixes that never point anywhere public: `.localhost` is
 * loopback by RFC 6761, `.local` is mDNS, `.internal` is the GCP/AWS internal
 * zone, `.home.arpa` is RFC 8375 home networks.
 */
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * IPv6 ranges that carry an IPv4 address in their low 32 bits. These have to
 * be judged on the address they carry, not on the v6 wrapper — otherwise
 * `::ffff:127.0.0.1` reads as loopback-free, and on a NAT64 network
 * `64:ff9b::a9fe:a9fe` is a perfectly ordinary route to 169.254.169.254.
 *
 * `rfc6052` (64:ff9b::/96) is not exotic: on an IPv6-only or NAT64 network,
 * every public IPv4 site resolves into it, so blanket-rejecting the range
 * would stop the crawler reaching anything at all.
 */
const IPV4_EMBEDDING_RANGES = new Set(['ipv4Mapped', 'rfc6145', 'rfc6052']);

/**
 * Legacy IPv6 tunnelling. Both encode an IPv4 address somewhere other than
 * the low 32 bits (and Teredo obfuscates it), and neither is ever a real
 * DNS answer for a website — so they're refused outright rather than decoded.
 */
const TUNNELLED_V6_RANGES = new Set(['6to4', 'teredo']);

/** Thrown when a host or address is not a legitimate public crawl target. */
export class SsrfBlockedError extends Error {
  constructor(
    readonly host: string,
    readonly detail: string,
  ) {
    super(`blocked non-public host ${host}: ${detail}`);
    this.name = 'SsrfBlockedError';
  }
}

/**
 * True when an IP literal is a normal, routable public address.
 *
 * `ipaddr.js` does the classifying: `loopback` (127/8, ::1), `linkLocal`
 * (169.254/16 — the metadata address), `private` (RFC 1918),
 * `carrierGradeNat` (100.64/10), `uniqueLocal` (fc00::/7), `multicast`,
 * `unspecified`, `reserved`, `broadcast`. Only `unicast` passes.
 */
export function isPublicAddress(address: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    return false;
  }

  if (parsed.kind() === 'ipv6') {
    const v6 = parsed as ipaddr.IPv6;
    const range = v6.range();
    if (IPV4_EMBEDDING_RANGES.has(range)) {
      return embeddedIPv4(v6).range() === 'unicast';
    }
    if (TUNNELLED_V6_RANGES.has(range)) return false;
    return range === 'unicast';
  }

  return parsed.range() === 'unicast';
}

/** The IPv4 address held in the low 32 bits of an IPv4-embedding IPv6 address. */
function embeddedIPv4(v6: ipaddr.IPv6): ipaddr.IPv4 {
  const high = v6.parts[6] ?? 0;
  const low = v6.parts[7] ?? 0;
  return new ipaddr.IPv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
}

/**
 * Rejects hostnames that can't be a public site by name alone — before any
 * DNS traffic. Cheap, and it catches the cases where the box's own resolver
 * would happily hand back a loopback address.
 */
export function assertAllowedHostname(hostname: string): void {
  // `new URL('http://[::1]/').hostname` keeps the brackets; strip them so the
  // literal parses.
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '');

  if (!host) {
    throw new SsrfBlockedError(hostname, 'empty hostname');
  }

  // An IP literal is decided here and now — there's no name to resolve.
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) {
      throw new SsrfBlockedError(hostname, 'non-public IP literal');
    }
    return;
  }

  if (host === 'localhost') {
    throw new SsrfBlockedError(hostname, 'localhost');
  }
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new SsrfBlockedError(hostname, 'internal-only TLD');
  }
  // A single-label name ("intranet", "metadata") can only resolve through a
  // local search domain — never a real site on the public internet.
  if (!host.includes('.')) {
    throw new SsrfBlockedError(hostname, 'bare single-label hostname');
  }
}

/**
 * Validates a URL's scheme and hostname, returning the parsed URL so callers
 * don't parse twice. Throws `SsrfBlockedError` for anything not crawlable.
 */
export function assertPublicUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfBlockedError(url, 'unparseable URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    // file:, ftp:, gopher: — all classic SSRF escalations.
    throw new SsrfBlockedError(parsed.hostname || url, `scheme ${parsed.protocol}`);
  }

  assertAllowedHostname(parsed.hostname);
  return parsed;
}

/**
 * Resolves a `Location` header against the hop it came from and re-runs the
 * full guard on the result.
 *
 * Relative Locations are legal and common, and so are the nasty ones: a
 * protocol-relative `//169.254.169.254/` inherits the current scheme and
 * would otherwise look like a same-origin path.
 */
export function resolveRedirectTarget(currentUrl: string, location: string): string {
  let next: URL;
  try {
    next = new URL(location, currentUrl);
  } catch {
    throw new SsrfBlockedError(location, 'unresolvable redirect target');
  }
  return assertPublicUrl(next.toString()).toString();
}

/**
 * DNS lookup that refuses to hand back a non-public address.
 *
 * undici calls this from inside the socket connect, so whatever it returns is
 * what gets dialed — no window between checking and connecting. This is the
 * piece that defeats DNS rebinding.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, '', 0);
      return;
    }

    const blocked = addresses.find((entry) => !isPublicAddress(entry.address));
    if (blocked) {
      callback(new SsrfBlockedError(hostname, `resolves to ${blocked.address}`), '', 0);
      return;
    }

    if (options.all) {
      callback(null, addresses);
      return;
    }

    const first = addresses[0];
    if (!first) {
      callback(new SsrfBlockedError(hostname, 'no addresses'), '', 0);
      return;
    }
    callback(null, first.address, first.family);
  });
};

/**
 * One agent (and therefore one connection pool) for the whole process, with
 * the guarded lookup baked in so no call site can forget it.
 */
const guardedAgent = new Agent({ connect: { lookup: guardedLookup } });

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal | undefined;
  /**
   * Where this crawl's requests resolve to. Omitted means ordinary DNS, which
   * is what every crawl did before the DNS integration existed.
   */
  route?: OriginRoute | undefined;
}

export interface SafeFetchResult {
  response: UndiciResponse;
  /** The URL actually fetched, after any redirect hops. */
  finalUrl: string;
}

/**
 * `fetch` that can only ever reach public hosts, following redirects by hand
 * so every hop is re-validated.
 *
 * URLs are never rewritten here. When a crawl is pinned to an origin (see
 * `origin-route.ts`), the only thing that changes is which dispatcher — and
 * therefore which resolved address — a hop uses; the request line, the `Host`
 * header and the TLS SNI stay exactly as the site publishes them.
 *
 * The final URL is returned explicitly: undici doesn't populate
 * `response.url` under `redirect: 'manual'`, and callers need it to resolve
 * relative links against the page they actually landed on.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  let currentUrl = assertPublicUrl(url).toString();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Pinned only for the site's own hostnames; a redirect that leaves the
    // site goes back to the default agent, at full certificate verification.
    const dispatcher = options.route?.dispatcherFor(currentUrl) ?? guardedAgent;

    const response = await undiciFetch(currentUrl, {
      headers: options.headers ?? {},
      redirect: 'manual',
      ...(options.signal ? { signal: options.signal } : {}),
      dispatcher,
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get('location');
    // Drain the redirect body so the connection goes back to the pool.
    await response.body?.cancel().catch(() => undefined);

    // A 3xx without a Location isn't followable — hand it back as-is and let
    // the caller's `res.ok` check reject it.
    if (!location) return { response, finalUrl: currentUrl };

    const next = resolveRedirectTarget(currentUrl, location);
    logger.debug({ from: currentUrl, to: next }, 'ssrf-guard: following redirect');
    currentUrl = next;
  }

  throw new Error(`too many redirects (>${MAX_REDIRECTS}) for ${url}`);
}

/**
 * True when a failure came from this guard rather than the network. undici
 * wraps a connect-phase error, so the cause chain has to be walked.
 */
export function isSsrfBlocked(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === 'object'; i++) {
    if (cur instanceof SsrfBlockedError) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
