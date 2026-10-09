import { z } from 'zod';

/**
 * Request schemas for the scraper's HTTP surface.
 *
 * Split out of `index.ts` so the validation can be unit-tested without booting
 * the express app.
 */

// Page budget — must stay in sync with the app's create-site schema
// (aigenic_app/lib/sites/limits.ts); the workspaces don't share code. The
// app always sends an explicit maxPages, so the default only covers direct
// API calls.
const MAX_PAGES_CAP = 2000;
const DEFAULT_MAX_PAGES = 1000;

/** `POST /crawl`. */
export const crawlRequestSchema = z.object({
  siteId: z.string().uuid(),
  startUrl: z.string().url(),
  maxPages: z.number().int().positive().max(MAX_PAGES_CAP).default(DEFAULT_MAX_PAGES),
  /**
   * Opaque to us: the app's staging generation for this crawl, echoed back on
   * every webhook so the receiver can tell this crawl's articles apart from a
   * superseded crawl's. Defaults to 0 for direct API calls that don't care.
   */
  generation: z.number().int().nonnegative().default(0),
  webhookUrl: z.string().url(),
});
