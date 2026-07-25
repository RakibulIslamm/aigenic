import ipaddr from 'ipaddr.js';

/**
 * Is this URL something we could plausibly crawl on the public internet?
 *
 * Defense-in-depth for SSRF, at the input boundary. The real guard lives in
 * the crawler (`vps-scraper/src/ssrf-guard.ts`), which re-checks the address
 * at connect time and on every redirect hop — it has to, because DNS can
 * change between a form submission and the crawl that follows it, and because
 * a public page can 302 to `169.254.169.254`.
 *
 * What this file adds is *early rejection*: a tenant who types
 * `http://10.0.0.5/` gets a validation error on the form instead of a site row
 * that quietly fails to crawl an hour later. Purely synchronous — no DNS
 * resolution here, so a hostname that *resolves* somewhere private still
 * passes and is caught downstream.
 *
 * **Kept deliberately in sync with `vps-scraper/src/ssrf-guard.ts`.** The two
 * workspaces don't share a package, so the mirror is by convention; the parity
 * test in `tests/app/public-url.test.ts` imports both and fails if they ever
 * disagree about a host. Change one, change the other.
 */

/**
 * Hostname suffixes that never point anywhere public: `.localhost` is
 * loopback by RFC 6761, `.local` is mDNS, `.internal` is the GCP/AWS internal
 * zone, `.home.arpa` is RFC 8375 home networks.
 */
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

/**
 * IPv6 ranges that carry an IPv4 address in their low 32 bits — judged on the
 * address they carry, not the wrapper, or `::ffff:127.0.0.1` reads as public.
 * `rfc6052` (64:ff9b::/96) is NAT64: on an IPv6-only network every public
 * IPv4 site lands in it, so it can't simply be rejected either.
 */
const IPV4_EMBEDDING_RANGES = new Set(['ipv4Mapped', 'rfc6145', 'rfc6052']);

/** Legacy IPv6 tunnelling — never a real answer for a website. Refused outright. */
const TUNNELLED_V6_RANGES = new Set(['6to4', 'teredo']);

/**
 * True when an IP literal is a normal, routable public address. `ipaddr.js`
 * does the classifying; only `unicast` passes, which rules out loopback,
 * link-local (169.254/16 — the cloud metadata address), RFC 1918,
 * carrier-grade NAT, unique-local, multicast, unspecified and broadcast.
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
 * True when a hostname can't be a public website by name alone: a non-public
 * IP literal, `localhost`, an internal-only suffix, or a single-label name
 * that could only resolve through a local search domain.
 */
export function isDisallowedHost(hostname: string): boolean {
  // `new URL('http://[::1]/').hostname` keeps the brackets; strip them so the
  // literal parses. Trailing dot is the FQDN form of the same name.
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '');

  if (!host) return true;

  // An IP literal is decided here and now — there's no name to resolve.
  if (ipaddr.isValid(host)) return !isPublicAddress(host);

  if (host === 'localhost') return true;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return !host.includes('.');
}
