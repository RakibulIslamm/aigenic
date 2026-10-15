/**
 * Named size/limit constants for the sites domain. Import-free on purpose —
 * both server code (zod schemas, queries) and client components (the
 * add-site dialog) read from here.
 */

/**
 * Crawl page budget. The cap must stay in sync with the scraper's own
 * request schema (vps-scraper/src/index.ts) — the workspaces don't share
 * code, so the sync is by convention until the root workspace lands.
 */
export const MIN_CRAWL_PAGES = 50;
export const DEFAULT_CRAWL_MAX_PAGES = 1000;
export const CRAWL_MAX_PAGES_CAP = 2000;

/** Articles per page on the knowledge tab (and the paged-query fallback). */
export const KB_PAGE_SIZE = 25;

/**
 * Longest `?q=` accepted by the knowledge search. The term goes into an
 * unindexed `ILIKE '%…%'` scan, so an unbounded value from a hand-edited URL
 * is a free way to make Postgres work hard. No real title search needs more.
 */
export const KB_SEARCH_MAX_CHARS = 100;

/** Rows on the full conversations tab — also the query's default. */
export const CONVERSATION_LIST_LIMIT = 200;
/** Rows in the site overview's "recent conversations" card. */
export const RECENT_CONVERSATIONS_LIMIT = 5;

/**
 * Manually added knowledge (pasted text and uploaded files) — the fallback
 * that works whatever a site's firewall does.
 *
 * The upload cap sits under Vercel's 4.5 MB request-body limit, and the
 * server-action `bodySizeLimit` in next.config.ts is set just above it so the
 * framework never cuts a legal upload short.
 */
export const MANUAL_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** Extracted text per document. A ~150-page manual; beyond that, split it. */
export const MANUAL_DOC_MAX_CHARS = 500_000;
/** Pasted text needs room for a full policy or FAQ page, not a book. */
export const MANUAL_TEXT_MAX_CHARS = 100_000;
export const MANUAL_TITLE_MAX_CHARS = 200;
/** Documents (not chunks) per site — keeps the KB something an owner can curate. */
export const MANUAL_DOCS_PER_SITE = 200;
/** File types the upload accepts, as the `accept` attribute and error copy use them. */
export const MANUAL_UPLOAD_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  '.markdown',
  '.html',
  '.htm',
  '.csv',
] as const;
