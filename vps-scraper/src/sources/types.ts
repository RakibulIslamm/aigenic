/**
 * Structured-source ingestion: shared vocabulary.
 *
 * Most of the sites we crawl are not bespoke HTML — they run on a platform
 * that already publishes its catalogue as documented, public JSON. Reading
 * that instead of scraping rendered pages wins three ways:
 *
 *  - **Volume.** A 1,000-product store is ~11 API requests at 100 per page,
 *    versus 1,000 page fetches. Same knowledge base, two orders of magnitude
 *    less traffic for the site we're a guest on.
 *  - **Fidelity.** Prices, SKUs, stock and categories arrive as fields.
 *    Readability guesses at them from markup, and often guesses wrong — a
 *    support bot quoting a stale or mis-parsed price is worse than one that
 *    says nothing.
 *  - **Reach.** These endpoints frequently sit outside the WAF rules that
 *    block page crawling, so a site that refuses the crawler may still answer
 *    here.
 *
 * Adapters never emit webhooks or touch the crawl budget themselves — they
 * return documents and let `crawler.ts` apply dedup, robots and budget rules
 * in exactly one place, the same ones the HTML path goes through.
 */

import type { OriginRoute } from '../origin-route.js';

/** Which platform adapter produced a batch of documents. */
export type SourceKind = 'shopify' | 'woocommerce' | 'wordpress';

/** One ingestible document, already flattened to plain text. */
export interface StructuredDoc {
  /**
   * The public page a visitor would read — what the assistant cites in an
   * answer. Never the API endpoint: nobody wants a citation to
   * `/wp-json/wc/store/v1/products?page=3`.
   */
  url: string;
  title: string;
  /** Plain text. Adapters flatten platform HTML before returning. */
  content: string;
}

export interface SourceContext {
  /** Site origin, e.g. `https://example.com` (no trailing slash). */
  origin: string;
  userAgent: string;
  /**
   * Where these requests go. Platform endpoints sit behind the same CDN as
   * the pages, so a crawl routed through `crawl.<domain>` reads them there
   * too — the origin serves the same JSON either way.
   */
  route: OriginRoute;
  /**
   * Hard cap on documents this adapter may return. Adapters stop paginating
   * once reached — the caller's budget is not a suggestion.
   */
  maxDocs: number;
  /**
   * May we *request* this API endpoint? Same-site plus robots.txt, and
   * deliberately NOT the frontier's `shouldSkipUrl` filter: that list exists
   * to keep junk out of the knowledge base and explicitly names `/wp-json/`,
   * so reusing it here would forbid the very endpoints this module reads.
   */
  isEndpointAllowed: (url: string) => boolean;
  /**
   * May we *ingest* this document's public URL? The full frontier policy —
   * same-site, `shouldSkipUrl`, robots.txt — so a page the HTML crawl would
   * refuse to index can't slip into the knowledge base through this door.
   */
  isDocumentAllowed: (url: string) => boolean;
  signal: AbortSignal | undefined;
}

export interface SourceBatch {
  kind: SourceKind;
  docs: StructuredDoc[];
}
