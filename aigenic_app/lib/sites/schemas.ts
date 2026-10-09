import { z } from 'zod';
import { CRAWL_MAX_PAGES_CAP, DEFAULT_CRAWL_MAX_PAGES, MIN_CRAWL_PAGES } from './limits';

/** RFC 5321's maximum forward-path length — longer can't be a real address. */
const EMAIL_MAX_CHARS = 254;

/** The `domain` field both site forms share: a full http(s) URL. */
function domainField() {
  return z
    .string()
    .trim()
    .min(1, 'Domain is required')
    .max(500)
    .refine(isHttpUrl, 'Must be a full URL, e.g. https://example.com');
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
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
