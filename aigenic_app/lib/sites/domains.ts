/**
 * Hostname arithmetic shared by the dashboard, the DNS adapters and the crawl
 * dispatcher.
 *
 * Deliberately import-free (no `server-only`, no Node builtins) so the client
 * components that render "crawl.example.com" can use the same function that
 * decides what the crawler actually fetches. Two implementations of this would
 * drift, and the failure mode is telling a customer to expect a hostname we
 * never create.
 */

/** Label prefixed to the apex to build the crawl hostname. */
export const CRAWL_SUBDOMAIN = 'crawl';

/**
 * Bare hostname of a stored site domain (which is always a full URL). Falls
 * back to the raw value so a malformed row renders as itself rather than
 * throwing inside a server component.
 */
export function hostnameOf(domain: string): string {
  try {
    return new URL(domain).hostname.toLowerCase();
  } catch {
    return domain.toLowerCase();
  }
}

/** `www.example.com` → `example.com`. Everything else is left alone. */
export function stripWww(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host.startsWith('www.') ? host.slice(4) : host;
}

/**
 * The hostname the crawler will fetch a site through.
 *
 * Always built off the `www.`-stripped host: a site enrolled as
 * `www.example.com` lives in the `example.com` zone, and
 * `crawl.www.example.com` would be a second wildcard-less label nobody has a
 * record for.
 */
export function crawlHostFor(domainOrHost: string): string {
  const host = stripWww(hostnameOf(domainOrHost));
  return `${CRAWL_SUBDOMAIN}.${host}`;
}

/**
 * Is `host` inside `zone`? True for the zone apex itself and for any
 * subdomain of it — the label boundary matters, or `notexample.com` would
 * match the `example.com` zone.
 */
export function hostInZone(host: string, zone: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  const z = zone.toLowerCase().replace(/\.$/, '');
  return h === z || h.endsWith(`.${z}`);
}

/**
 * The zone that should hold a host's records: the longest zone name the host
 * sits inside. Longest wins because an account can legitimately hold both
 * `example.com` and `shop.example.com` as separate zones, and a record for
 * `crawl.shop.example.com` belongs in the more specific one.
 */
export function pickZoneForHost<T extends { name: string }>(
  zones: readonly T[],
  host: string,
): T | null {
  let best: T | null = null;
  for (const zone of zones) {
    if (!hostInZone(host, zone.name)) continue;
    if (!best || zone.name.length > best.name.length) best = zone;
  }
  return best;
}

/**
 * The record name to create, relative to its zone: `crawl` in the
 * `example.com` zone, `crawl.shop` if the zone is `example.com` but the site
 * is `shop.example.com`. Returns null when the host isn't in the zone at all,
 * which is a caller bug worth failing on rather than papering over.
 */
export function relativeRecordName(host: string, zone: string): string | null {
  const h = host.toLowerCase().replace(/\.$/, '');
  const z = zone.toLowerCase().replace(/\.$/, '');
  if (h === z) return '@';
  if (!h.endsWith(`.${z}`)) return null;
  return h.slice(0, -(z.length + 1));
}
