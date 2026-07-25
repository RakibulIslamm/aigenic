import { z } from 'zod';
import { isDisallowedHost } from '@/lib/http/public-url';
import { CRAWL_MAX_PAGES_CAP, DEFAULT_CRAWL_MAX_PAGES, MIN_CRAWL_PAGES } from './limits';

/** RFC 5321's maximum forward-path length — longer can't be a real address. */
const EMAIL_MAX_CHARS = 254;

/**
 * The `domain` field both site forms share: a full http(s) URL pointing at a
 * plausibly-public host.
 *
 * The public-host check is defense-in-depth against SSRF — a private target
 * gets a form error instead of a site row that fails its crawl an hour later.
 * It is *not* the real guard: DNS can change between this validation and the
 * fetch, so the crawler re-checks every address at connect time and every
 * redirect hop (`vps-scraper/src/ssrf-guard.ts`), and the scraper re-runs this
 * same check on the `/crawl` payload.
 *
 * Two checks rather than one so the message tells the user which mistake they
 * made. Both can fire on the same value; the actions surface the first issue
 * per field, and "not a URL" is the more useful of the two.
 */
function domainField() {
  return z
    .string()
    .trim()
    .min(1, 'Domain is required')
    .max(500)
    .refine(isHttpUrl, 'Must be a full URL, e.g. https://example.com')
    .refine(
      hasPublicHost,
      "Enter a public website — local and private addresses can't be crawled",
    );
}

function isHttpUrl(value: string): boolean {
  const protocol = parseUrl(value)?.protocol;
  return protocol === 'http:' || protocol === 'https:';
}

/** Passes anything unparseable so only `isHttpUrl` reports that failure. */
function hasPublicHost(value: string): boolean {
  const url = parseUrl(value);
  return !url || !isDisallowedHost(url.hostname);
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export const createSiteSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  domain: domainField(),
  escalationEmail: z.string().trim().max(EMAIL_MAX_CHARS).email('Enter a valid email'),
  maxPages: z.coerce
    .number()
    .int()
    .min(MIN_CRAWL_PAGES)
    .max(CRAWL_MAX_PAGES_CAP)
    .default(DEFAULT_CRAWL_MAX_PAGES),
});

export const updateSiteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  domain: domainField(),
  escalationEmail: z.string().trim().max(EMAIL_MAX_CHARS).email(),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a hex color like #7c5cff'),
  greeting: z.string().trim().min(1).max(280),
  botName: z.string().trim().min(1).max(50),
});

export const DEFAULT_WIDGET_CONFIG = {
  primaryColor: '#7c5cff',
  greeting: "Hey! I'm here to help. Ask me anything about us.",
  botName: 'Support',
} as const;
