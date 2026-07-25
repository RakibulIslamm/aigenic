import { logger } from './logger.js';
import { isSsrfBlocked, safeFetch } from './ssrf-guard.js';
import {
  isSameSite,
  normalizeUrl,
  shouldSkipUrl,
  type NormalizedSite,
} from './url-utils.js';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_SITEMAPS = 50;
const MAX_URLS = 5_000;

interface DiscoverOptions {
  origin: string;
  site: NormalizedSite;
  userAgent: string;
  /** Raw robots.txt body the crawler already fetched ('' when unavailable). */
  robotsBody: string;
}

/**
 * Discovers product/article URLs by walking sitemap.xml and any nested
 * sitemap-index entries. Returns same-site URLs only, normalized, deduped,
 * skip-pattern-filtered, capped at MAX_URLS. Failures are swallowed —
 * sitemaps are an optimization, not a requirement.
 */
export async function discoverSitemapUrls({
  origin,
  site,
  userAgent,
  robotsBody,
}: DiscoverOptions): Promise<string[]> {
  const seedCandidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
  ];

  const robotsSitemaps = extractSitemapsFromRobotsBody(robotsBody);
  const initial = [...new Set([...robotsSitemaps, ...seedCandidates])];

  const visited = new Set<string>();
  const queue = [...initial];
  const urls = new Set<string>();

  while (queue.length > 0 && visited.size < MAX_SITEMAPS && urls.size < MAX_URLS) {
    const sitemapUrl = queue.shift()!;
    if (visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);

    const body = await fetchText(sitemapUrl, userAgent);
    if (!body) continue;

    if (looksLikeSitemapIndex(body)) {
      for (const loc of extractLocs(body)) {
        if (!visited.has(loc)) queue.push(loc);
      }
    } else {
      for (const loc of extractLocs(body)) {
        if (!isSameSite(loc, site)) continue;
        if (shouldSkipUrl(loc)) continue;
        const normalized = normalizeUrl(loc);
        if (!normalized) continue;
        urls.add(normalized);
        if (urls.size >= MAX_URLS) break;
      }
    }
  }

  const out = [...urls];
  logger.info(
    { origin, sitemapsVisited: visited.size, urlsFound: out.length },
    'sitemap discovery complete',
  );
  return out;
}

function extractSitemapsFromRobotsBody(body: string): string[] {
  if (!body) return [];
  const found: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*sitemap\s*:\s*(\S+)\s*$/i);
    if (m && m[1]) found.push(m[1]);
  }
  return found;
}

async function fetchText(url: string, userAgent: string): Promise<string | null> {
  try {
    // Sitemap URLs are attacker-influenced twice over: a `Sitemap:` line in
    // robots.txt and a `<loc>` inside a sitemap index are both remote input,
    // and neither has passed `isSameSite` at this point.
    const { response: res } = await safeFetch(url, {
      headers: { 'User-Agent': userAgent, Accept: 'application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    if (isSsrfBlocked(err)) {
      logger.warn({ url }, 'ssrf-guard: blocked sitemap fetch');
    }
    return null;
  }
}

function looksLikeSitemapIndex(body: string): boolean {
  return /<sitemapindex[\s>]/i.test(body);
}

function extractLocs(body: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) out.push(decodeXmlEntities(m[1]));
  }
  return out;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
