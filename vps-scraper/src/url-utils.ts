/**
 * URL normalization, same-site guard, and skip-pattern filtering.
 *
 * The crawler is strictly same-site: an external link discovered inside the
 * tenant's pages is never enqueued. "Same site" here means the registrable
 * hostname after stripping a leading `www.` — so `example.com` and
 * `www.example.com` are treated as the same site, but `blog.example.com`,
 * `cdn.example.com`, and any third-party host are external.
 */

const TRACKING_PARAMS = new Set([
  // Google / Analytics
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'utm_source_platform',
  'utm_creative_format',
  'utm_marketing_tactic',
  '_ga',
  '_gl',
  'gclid',
  'gbraid',
  'wbraid',
  'dclid',
  // Meta / Facebook
  'fbclid',
  'fb_action_ids',
  'fb_action_types',
  // Microsoft / Bing
  'msclkid',
  // Yandex
  'yclid',
  // Twitter / X
  'twclid',
  // Mailchimp
  'mc_cid',
  'mc_eid',
  // HubSpot
  '__hssc',
  '__hstc',
  'hsCtaTracking',
  '_hsenc',
  '_hsmi',
  // Instagram
  'igshid',
  // Vero / Drip / generic
  'vero_id',
  'vero_conv',
  'oly_anon_id',
  'oly_enc_id',
  'ref',
  'ref_src',
  'ref_url',
  'referrer',
  'source',
  'src',
]);

const SKIP_EXTENSIONS = new Set([
  // images
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.bmp',
  '.tiff',
  '.tif',
  '.avif',
  '.heic',
  // video / audio
  '.mp4',
  '.webm',
  '.mov',
  '.avi',
  '.mkv',
  '.m4v',
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',
  '.m4a',
  // documents
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.rtf',
  // archives
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.rar',
  '.7z',
  '.bz2',
  // assets
  '.css',
  '.js',
  '.mjs',
  '.map',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  // binaries
  '.dmg',
  '.exe',
  '.iso',
  '.bin',
  '.apk',
  '.ipa',
  '.deb',
  '.rpm',
]);

const SKIP_PATH_PATTERNS: RegExp[] = [
  /\/cart(?:\/|$)/i,
  /\/checkout(?:\/|$)/i,
  /\/my-account(?:\/|$)/i,
  /\/account(?:\/|$)/i,
  /\/login(?:\/|$)/i,
  /\/logout(?:\/|$)/i,
  /\/signin(?:\/|$)/i,
  /\/sign-in(?:\/|$)/i,
  /\/signup(?:\/|$)/i,
  /\/sign-up(?:\/|$)/i,
  /\/register(?:\/|$)/i,
  /\/wp-admin(?:\/|$)/i,
  /\/wp-login\.php/i,
  /\/wp-json(?:\/|$)/i,
  /\/xmlrpc\.php/i,
  /\/admin(?:\/|$)/i,
  /\/feed(?:\/|$)/i,
  /\/rss(?:\/|$)/i,
  /\/atom(?:\/|$)/i,
  /\/comments\/feed/i,
  /\/trackback(?:\/|$)/i,
  /\/print(?:\/|$)/i,
  /\/email-to-friend/i,
  /\/wishlist(?:\/|$)/i,
  /\/compare(?:\/|$)/i,
  /\/share(?:\/|$)/i,
  /\/tag\/page\/\d+/i,
  /\/page\/\d{3,}/i, // e.g. /page/100+ — almost always a tail
];

const SKIP_QUERY_KEYS: RegExp[] = [
  /^add[-_]to[-_]cart$/i,
  /^add[-_]to[-_]wishlist$/i,
  /^remove[-_]item$/i,
  /^action$/i,
  /^orderby$/i,
  /^order$/i,
  /^sort$/i,
  /^filter_/i,
  /^min_price$/i,
  /^max_price$/i,
  /^replytocom$/i,
  /^share$/i,
  /^print$/i,
];

export interface NormalizedSite {
  /** Hostname with leading `www.` stripped, lowercased. */
  hostname: string;
}

export function buildSite(startUrl: string): NormalizedSite | null {
  try {
    const u = new URL(startUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return { hostname: stripWww(u.hostname.toLowerCase()) };
  } catch {
    return null;
  }
}

export function isSameSite(url: string, site: NormalizedSite): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return stripWww(u.hostname.toLowerCase()) === site.hostname;
  } catch {
    return false;
  }
}

/**
 * Aggressive normalization: drops tracking params, sorts query keys, strips
 * the fragment + trailing slash, lowercases host, removes default ports.
 * Returns null if the URL is unparseable or non-http(s).
 */
export function normalizeUrl(input: string): string | null {
  try {
    const u = new URL(input);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

    u.hostname = u.hostname.toLowerCase();

    if (
      (u.protocol === 'http:' && u.port === '80') ||
      (u.protocol === 'https:' && u.port === '443')
    ) {
      u.port = '';
    }

    u.hash = '';

    const kept: Array<[string, string]> = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (TRACKING_PARAMS.has(k.toLowerCase())) continue;
      kept.push([k, v]);
    }
    kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    // Re-assemble the search string deterministically.
    const params = new URLSearchParams();
    for (const [k, v] of kept) params.append(k, v);
    u.search = params.toString() ? `?${params.toString()}` : '';

    // Strip trailing slash on non-root paths so /a/b/ and /a/b dedup together.
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }

    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Filter for URLs we never want to enqueue: non-HTML assets, auth/account
 * pages, RSS feeds, faceted-search query traps, and similar. Cheap to call —
 * use this on every URL before adding to the frontier.
 */
export function shouldSkipUrl(url: string): boolean {
  try {
    const u = new URL(url);

    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;

    const path = u.pathname.toLowerCase();
    const dotIdx = path.lastIndexOf('.');
    if (dotIdx !== -1 && dotIdx > path.lastIndexOf('/')) {
      const ext = path.slice(dotIdx);
      if (SKIP_EXTENSIONS.has(ext)) return true;
    }

    for (const re of SKIP_PATH_PATTERNS) {
      if (re.test(u.pathname)) return true;
    }

    for (const key of u.searchParams.keys()) {
      for (const re of SKIP_QUERY_KEYS) {
        if (re.test(key)) return true;
      }
    }

    return false;
  } catch {
    return true;
  }
}

function stripWww(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host;
}
