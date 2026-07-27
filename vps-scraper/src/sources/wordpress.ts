import { logger } from '../logger.js';
import { fetchJson } from './http.js';
import { htmlToText } from './html-text.js';
import type { SourceBatch, SourceContext, StructuredDoc } from './types.js';

/**
 * WordPress REST API, plus the WooCommerce Store API when the shop is present.
 *
 * `/wp-json/` is enabled by default on WordPress and lists the namespaces the
 * site exposes, which makes it both the probe and the capability check. Two
 * namespaces matter:
 *
 *  - `wc/store/v1` — WooCommerce's **public** Store API (the one the cart
 *    front-end uses). Not `wc/v3`, which needs API keys we have no business
 *    asking a customer for.
 *  - `wp/v2` — core posts and pages: the About, Delivery, Returns and FAQ
 *    pages a support assistant is asked about far more often than any product.
 *
 * `_fields` trims responses to what we ingest, which on a page with a large
 * embedded builder payload is the difference between kilobytes and megabytes.
 */

const PAGE_SIZE = 100;
/** Runaway guard per collection; the real bound is the caller's `maxDocs`. */
const MAX_PAGES = 40;

/**
 * Slots held back from the product catalogue for core pages and posts.
 *
 * Without this, a 1,000-product shop consumes the entire budget and the
 * Delivery, Returns, About and FAQ pages — a few dozen documents that answer
 * most actual support questions — never get read at all. They are cheap and
 * disproportionately useful, so they get a floor rather than the leftovers.
 */
const CONTENT_RESERVE_MAX = 100;
const CONTENT_RESERVE_RATIO = 0.15;

interface WpRendered {
  rendered?: string | null;
}

interface WpPost {
  link?: string | null;
  title?: WpRendered | null;
  content?: WpRendered | null;
  excerpt?: WpRendered | null;
}

interface WooPrices {
  price?: string | null;
  regular_price?: string | null;
  sale_price?: string | null;
  currency_code?: string | null;
  currency_symbol?: string | null;
  currency_minor_unit?: number | null;
}

interface WooProduct {
  name?: string | null;
  permalink?: string | null;
  sku?: string | null;
  description?: string | null;
  short_description?: string | null;
  prices?: WooPrices | null;
  categories?: Array<{ name?: string | null }> | null;
  is_in_stock?: boolean | null;
  average_rating?: string | number | null;
  review_count?: number | null;
}

/**
 * Probes `/wp-json/` and reads whatever the site exposes. Returns an empty
 * array for anything that isn't WordPress.
 *
 * Products are read first when a shop is present — on a store the catalogue is
 * the bulk of the knowledge base — but only up to `maxDocs` minus a reserve
 * held back for core pages, so the long product tail can't crowd out the
 * policy pages. Whatever the reserve doesn't use returns to nobody: the HTML
 * crawl gets the rest of the crawl budget regardless.
 */
export async function fetchWordPressDocs(ctx: SourceContext): Promise<SourceBatch[]> {
  const rootUrl = `${ctx.origin}/wp-json/`;
  if (!ctx.isEndpointAllowed(rootUrl)) return [];

  const root = await fetchJson<{ namespaces?: string[] }>({
    url: rootUrl,
    userAgent: ctx.userAgent,
    route: ctx.route,
    signal: ctx.signal,
  });

  const namespaces = root?.data?.namespaces;
  if (!Array.isArray(namespaces)) return [];

  const hasShop = namespaces.includes('wc/store/v1');
  const hasCore = namespaces.includes('wp/v2');

  // Only hold pages back from a catalogue — with no shop competing for the
  // budget there is nothing to protect them from.
  const reserve =
    hasShop && hasCore
      ? Math.min(CONTENT_RESERVE_MAX, Math.floor(ctx.maxDocs * CONTENT_RESERVE_RATIO))
      : 0;

  const batches: SourceBatch[] = [];
  let budget = ctx.maxDocs;

  if (hasShop) {
    const products = await fetchWooProducts({ ...ctx, maxDocs: budget - reserve });
    budget -= products.length;
    if (products.length > 0) batches.push({ kind: 'woocommerce', docs: products });
  }

  const content: StructuredDoc[] = [];
  if (hasCore) {
    for (const collection of ['pages', 'posts'] as const) {
      if (budget <= 0 || ctx.signal?.aborted) break;
      const docs = await fetchWpCollection(collection, { ...ctx, maxDocs: budget });
      budget -= docs.length;
      content.push(...docs);
    }
  }
  if (content.length > 0) batches.push({ kind: 'wordpress', docs: content });

  return batches;
}

/** WooCommerce Store API products — public, no credentials. */
async function fetchWooProducts(ctx: SourceContext): Promise<StructuredDoc[]> {
  const docs: StructuredDoc[] = [];

  for (let page = 1; page <= MAX_PAGES && docs.length < ctx.maxDocs; page++) {
    if (ctx.signal?.aborted) break;

    const url = `${ctx.origin}/wp-json/wc/store/v1/products?per_page=${PAGE_SIZE}&page=${page}`;
    if (!ctx.isEndpointAllowed(url)) break;

    const result = await fetchJson<WooProduct[]>({
      url,
      userAgent: ctx.userAgent,
      route: ctx.route,
      signal: ctx.signal,
    });
    const products = result?.data;
    if (!Array.isArray(products) || products.length === 0) break;

    for (const product of products) {
      if (docs.length >= ctx.maxDocs) break;
      const doc = toProductDoc(product);
      if (doc && ctx.isDocumentAllowed(doc.url)) docs.push(doc);
    }

    if (!hasMorePages(result?.header, page) || products.length < PAGE_SIZE) break;
  }

  if (docs.length > 0) {
    logger.info(
      { origin: ctx.origin, products: docs.length },
      'woocommerce catalogue read',
    );
  }
  return docs;
}

/** Core `wp/v2` posts or pages. */
async function fetchWpCollection(
  collection: 'posts' | 'pages',
  ctx: SourceContext,
): Promise<StructuredDoc[]> {
  const docs: StructuredDoc[] = [];

  for (let page = 1; page <= MAX_PAGES && docs.length < ctx.maxDocs; page++) {
    if (ctx.signal?.aborted) break;

    const url = `${ctx.origin}/wp-json/wp/v2/${collection}?per_page=${PAGE_SIZE}&page=${page}&_fields=link,title,content,excerpt`;
    if (!ctx.isEndpointAllowed(url)) break;

    const result = await fetchJson<WpPost[]>({
      url,
      userAgent: ctx.userAgent,
      route: ctx.route,
      signal: ctx.signal,
    });
    const items = result?.data;
    if (!Array.isArray(items) || items.length === 0) break;

    for (const item of items) {
      if (docs.length >= ctx.maxDocs) break;
      const doc = toPostDoc(item);
      if (doc && ctx.isDocumentAllowed(doc.url)) docs.push(doc);
    }

    if (!hasMorePages(result?.header, page) || items.length < PAGE_SIZE) break;
  }

  if (docs.length > 0) {
    logger.info(
      { origin: ctx.origin, collection, count: docs.length },
      'wordpress content read',
    );
  }
  return docs;
}

function toProductDoc(product: WooProduct): StructuredDoc | null {
  const title = htmlToText(product.name ?? '').trim();
  const url = product.permalink?.trim();
  if (!title || !url) return null;

  const lines: string[] = [`Product: ${title}`];

  const categories = (product.categories ?? [])
    .map((c) => c?.name?.trim())
    .filter((n): n is string => Boolean(n));
  if (categories.length > 0) lines.push(`Category: ${categories.join(', ')}`);

  if (product.sku?.trim()) lines.push(`SKU: ${product.sku.trim()}`);

  const price = describeWooPrice(product.prices);
  if (price) lines.push(price);

  if (typeof product.is_in_stock === 'boolean') {
    lines.push(`Availability: ${product.is_in_stock ? 'in stock' : 'out of stock'}`);
  }

  const rating = Number(product.average_rating);
  if (Number.isFinite(rating) && rating > 0) {
    const count = product.review_count ?? 0;
    lines.push(`Rating: ${rating}${count > 0 ? ` (${count} reviews)` : ''}`);
  }

  const summary = htmlToText(product.short_description ?? '');
  const body = htmlToText(product.description ?? '');
  if (summary) lines.push('', summary);
  // Skip the long description when it merely repeats the summary.
  if (body && body !== summary) lines.push('', body);

  return { url, title, content: lines.join('\n') };
}

function toPostDoc(item: WpPost): StructuredDoc | null {
  const title = htmlToText(item.title?.rendered ?? '').trim();
  const url = item.link?.trim();
  if (!url) return null;

  const body = htmlToText(item.content?.rendered ?? '');
  const excerpt = htmlToText(item.excerpt?.rendered ?? '');
  const content = body || excerpt;
  if (!content) return null;

  // Most themes render the page title as the first heading of the content, so
  // prepending it unconditionally stores "Delivery policy\nDelivery policy…".
  // Harmless but wasteful, and it dilutes the text that gets retrieved.
  const titled =
    title && !content.toLowerCase().startsWith(title.toLowerCase())
      ? `${title}\n\n${content}`
      : content;

  return { url, title: title || url, content: titled };
}

/**
 * Money arrives as an integer string in the currency's minor unit — `"275000"`
 * with `currency_minor_unit: 2` means 2750.00. Reading that field as a plain
 * number would quote a customer a price a hundred times too high, so the
 * conversion is not optional.
 */
function describeWooPrice(prices: WooPrices | null | undefined): string | null {
  if (!prices) return null;

  const minorUnit = Number.isFinite(prices.currency_minor_unit)
    ? (prices.currency_minor_unit as number)
    : 2;
  const symbol = htmlToText(prices.currency_symbol ?? '').trim();
  const code = prices.currency_code?.trim() ?? '';

  const current = toMajorUnits(prices.price, minorUnit);
  if (current === null) return null;

  const regular = toMajorUnits(prices.regular_price, minorUnit);
  const label = (value: string) =>
    `${symbol || ''}${value}${symbol ? '' : ` ${code}`}`.trim();

  // Only call it a discount when the regular price is genuinely higher —
  // WooCommerce sets `regular_price` even when nothing is on sale.
  if (regular !== null && Number(regular) > Number(current)) {
    return `Price: ${label(current)} (was ${label(regular)})`;
  }
  return `Price: ${label(current)}`;
}

function toMajorUnits(raw: string | null | undefined, minorUnit: number): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const major = value / 10 ** Math.max(0, minorUnit);
  return major.toFixed(Math.max(0, Math.min(minorUnit, 4)));
}

/**
 * WordPress reports the page count in `X-WP-TotalPages`. Absent (some caching
 * layers strip it) we return true and let the short-page check stop us.
 */
function hasMorePages(
  header: ((name: string) => string | null) | undefined,
  currentPage: number,
): boolean {
  const total = Number(header?.('x-wp-totalpages') ?? '');
  if (!Number.isFinite(total) || total <= 0) return true;
  return currentPage < total;
}
