import { logger } from '../logger.js';
import { fetchJson } from './http.js';
import { htmlToText } from './html-text.js';
import type { SourceContext, StructuredDoc } from './types.js';

/**
 * Shopify storefront catalogue via the public `/products.json` endpoint.
 *
 * This is documented, unauthenticated, and the same data the storefront theme
 * renders — we are reading the shop's own product feed, not circumventing
 * anything. Shopify caps `limit` at 250 and paginates with `?page=`.
 *
 * Every product's public URL is `/products/{handle}`, which is what we cite.
 */

const PAGE_SIZE = 250;
/** Stop after this many pages regardless of budget — a runaway guard, not a limit. */
const MAX_PAGES = 40;

interface ShopifyVariant {
  price?: string | number | null;
  sku?: string | null;
  available?: boolean | null;
  title?: string | null;
}

interface ShopifyProduct {
  title?: string | null;
  handle?: string | null;
  body_html?: string | null;
  vendor?: string | null;
  product_type?: string | null;
  tags?: string[] | string | null;
  variants?: ShopifyVariant[] | null;
}

/**
 * Returns products, or an empty array when this isn't a Shopify store. The
 * first request doubles as the platform probe: a non-Shopify site answers 404
 * or serves HTML, both of which `fetchJson` turns into null.
 */
export async function fetchShopifyProducts(ctx: SourceContext): Promise<StructuredDoc[]> {
  const docs: StructuredDoc[] = [];

  for (let page = 1; page <= MAX_PAGES && docs.length < ctx.maxDocs; page++) {
    if (ctx.signal?.aborted) break;

    const url = `${ctx.origin}/products.json?limit=${PAGE_SIZE}&page=${page}`;
    if (!ctx.isEndpointAllowed(url)) {
      // robots.txt disallowing the feed is a real answer, not an obstacle:
      // fall back to the HTML crawl, which robots governs page by page.
      if (page === 1) logger.debug({ url }, 'shopify feed disallowed by robots.txt');
      break;
    }

    const result = await fetchJson<{ products?: ShopifyProduct[] }>({
      url,
      userAgent: ctx.userAgent,
      route: ctx.route,
      signal: ctx.signal,
    });

    const products = result?.data?.products;
    if (!Array.isArray(products) || products.length === 0) break;

    for (const product of products) {
      if (docs.length >= ctx.maxDocs) break;
      const doc = toDoc(product, ctx.origin);
      if (doc && ctx.isDocumentAllowed(doc.url)) docs.push(doc);
    }

    // A short page is the last page. Shopify has no total-count header here.
    if (products.length < PAGE_SIZE) break;
  }

  if (docs.length > 0) {
    logger.info({ origin: ctx.origin, products: docs.length }, 'shopify catalogue read');
  }
  return docs;
}

function toDoc(product: ShopifyProduct, origin: string): StructuredDoc | null {
  const title = product.title?.trim();
  const handle = product.handle?.trim();
  if (!title || !handle) return null;

  const lines: string[] = [`Product: ${title}`];

  if (product.vendor?.trim()) lines.push(`Brand: ${product.vendor.trim()}`);
  if (product.product_type?.trim())
    lines.push(`Category: ${product.product_type.trim()}`);

  const tags = normalizeTags(product.tags);
  if (tags) lines.push(`Tags: ${tags}`);

  const priceLine = describePrices(product.variants);
  if (priceLine) lines.push(priceLine);

  const stock = describeStock(product.variants);
  if (stock) lines.push(stock);

  const description = htmlToText(product.body_html ?? '');
  if (description) lines.push('', description);

  return {
    url: `${origin}/products/${handle}`,
    title,
    content: lines.join('\n'),
  };
}

/**
 * A price range across variants, or a single price when they agree. Shopify
 * gives prices as decimal strings in the shop's currency, with no currency
 * field on this endpoint — so we deliberately state the number without
 * inventing a symbol we don't actually know.
 */
function describePrices(variants: ShopifyVariant[] | null | undefined): string | null {
  if (!Array.isArray(variants) || variants.length === 0) return null;

  const prices = variants
    .map((v) => Number(v.price))
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (prices.length === 0) return null;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `Price: ${format(min)}` : `Price: ${format(min)} – ${format(max)}`;
}

function describeStock(variants: ShopifyVariant[] | null | undefined): string | null {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  // `available` is absent on some API versions; only claim a stock state when
  // at least one variant actually reports one.
  const known = variants.filter((v) => typeof v.available === 'boolean');
  if (known.length === 0) return null;
  return known.some((v) => v.available)
    ? 'Availability: in stock'
    : 'Availability: sold out';
}

function normalizeTags(tags: string[] | string | null | undefined): string | null {
  if (Array.isArray(tags)) {
    const cleaned = tags.map((t) => String(t).trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned.join(', ') : null;
  }
  const trimmed = tags?.trim();
  return trimmed ? trimmed : null;
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
