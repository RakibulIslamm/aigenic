import { z } from 'zod';
import { assertPublicUrl } from './ssrf-guard.js';

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

/**
 * `POST /crawl`.
 *
 * `startUrl` is refused up front if it isn't a public http(s) target. Holding
 * the API key gets you a crawl, not a proxy into this box's network — so even
 * a direct caller (or a stale `sites.domain` row created before the app-side
 * check existed) can't smuggle `http://169.254.169.254/` past here. The guard
 * runs again at fetch time, where it can also judge what the name resolves to.
 *
 * `webhookUrl` is deliberately *not* guarded: it's our own app's address, and
 * local dev points it at `127.0.0.1`.
 */
export const crawlRequestSchema = z.object({
  siteId: z.string().uuid(),
  startUrl: z
    .string()
    .url()
    .refine(isPublicHttpUrl, 'startUrl must be a public http(s) URL'),
  maxPages: z.number().int().positive().max(MAX_PAGES_CAP).default(DEFAULT_MAX_PAGES),
  /**
   * Opaque to us: the app's staging generation for this crawl, echoed back on
   * every webhook so the receiver can tell this crawl's articles apart from a
   * superseded crawl's. Defaults to 0 for direct API calls that don't care.
   */
  generation: z.number().int().nonnegative().default(0),
  /**
   * The site's crawl secret, sent as `X-Aigenic-Verify` on every request this
   * job makes. A verified site owner matches the value in their firewall to
   * let us through — unlike a User-Agent, it can't be forged by a third
   * party. Absent for sites whose ownership hasn't been proven; the header is
   * then simply not sent. Opaque here: the app decides who gets one.
   */
  verifyToken: z.string().min(8).max(256).optional(),
  webhookUrl: z.string().url(),
});

function isPublicHttpUrl(value: string): boolean {
  try {
    assertPublicUrl(value);
    return true;
  } catch {
    return false;
  }
}
