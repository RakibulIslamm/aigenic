import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';

// JSDOM logs "Could not parse CSS stylesheet" to the parent console for every
// vendor-specific CSS rule it doesn't recognize. We don't render CSS — silence
// these to keep crawl logs readable.
const silentConsole = new VirtualConsole();
silentConsole.on('error', () => undefined);
silentConsole.on('warn', () => undefined);
silentConsole.on('jsdomError', () => undefined);

function parseDom(html: string, url: string): JSDOM {
  return new JSDOM(html, { url, virtualConsole: silentConsole });
}

export interface ExtractedArticle {
  title: string;
  content: string;
  excerpt: string | null;
  wordCount: number;
}

export interface ParsedPage {
  article: ExtractedArticle | null;
  canonical: string | null;
  internalLinks: string[];
}

const MIN_WORDS = 12;
const MAX_CONTENT_LEN = 80_000;
const MAX_TITLE_LEN = 500;

/**
 * Single-pass parse: builds the JSDOM once and extracts the article, the
 * `<link rel="canonical">` (if any), and all same-origin internal links. This
 * is the entry point used by the crawler.
 */
export function parsePage(html: string, url: string): ParsedPage {
  const dom = parseDom(html, url);
  const doc = dom.window.document;

  const article = extractArticleFromDoc(doc, url);
  const canonical = extractCanonicalFromDoc(doc, url);
  const internalLinks = extractInternalLinksFromDoc(doc, url);

  return { article, canonical, internalLinks };
}

/**
 * Pulls usable content from a rendered HTML page. Tries three strategies in
 * order: JSON-LD structured data (catches product / FAQ / article pages on
 * Shopify/Woo/Webflow), Mozilla Readability (long-form articles), and a
 * plain h1+meta+body fallback (anything else, including thin product pages).
 * Returns null only when every strategy fails or the page is empty.
 */
function extractArticleFromDoc(doc: Document, url: string): ExtractedArticle | null {
  const structured = extractStructured(doc);
  if (structured && wordCount(structured.content) >= MIN_WORDS) {
    return finalize(structured);
  }

  const readable = extractReadable(doc, url);
  if (readable && wordCount(readable.content) >= MIN_WORDS) {
    return finalize(readable);
  }

  const fallback = extractFallback(doc, url);
  if (fallback && wordCount(fallback.content) >= MIN_WORDS) {
    return finalize(fallback);
  }

  return null;
}

function extractCanonicalFromDoc(doc: Document, baseUrl: string): string | null {
  const link = doc.querySelector('link[rel="canonical"]');
  const href = link?.getAttribute('href')?.trim();
  if (!href) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractReadable(
  doc: Document,
  url: string
): { title: string; content: string; excerpt: string | null } | null {
  // Deliberately no isProbablyReaderable gate — the heuristic rejects a lot of
  // valid pages (thin product pages still parse cleanly). We validate the
  // parse result downstream instead.
  try {
    const reader = new Readability(doc.cloneNode(true) as Document);
    const article = reader.parse();
    if (!article || !article.textContent) return null;

    const cleaned = collapseWhitespace(article.textContent);
    if (!cleaned) return null;

    const title =
      article.title?.trim() ||
      doc.querySelector('title')?.textContent?.trim() ||
      new URL(url).pathname;

    return {
      title,
      content: cleaned,
      excerpt: article.excerpt?.trim() ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * JSON-LD: Shopify, WooCommerce, Webflow, and most modern e-commerce platforms
 * embed `application/ld+json` blocks describing Product, Article, FAQPage,
 * BreadcrumbList, etc. We harvest the rich text from whichever ones we find.
 */
function extractStructured(
  doc: Document
): { title: string; content: string; excerpt: string | null } | null {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  if (scripts.length === 0) return null;

  const nodes: unknown[] = [];
  for (const s of scripts) {
    const raw = s.textContent?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      collectJsonLdNodes(parsed, nodes);
    } catch {
      // tolerate vendor-broken JSON-LD blobs
    }
  }
  if (nodes.length === 0) return null;

  const parts: string[] = [];
  let title: string | null = null;
  let excerpt: string | null = null;

  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const obj = node as Record<string, unknown>;
    const type = normalizeType(obj['@type']);

    if (type === 'Product') {
      const product = describeProduct(obj);
      if (product) {
        if (!title) title = product.title;
        if (!excerpt) excerpt = product.excerpt;
        parts.push(product.body);
      }
    } else if (type === 'Article' || type === 'NewsArticle' || type === 'BlogPosting') {
      const article = describeArticle(obj);
      if (article) {
        if (!title) title = article.title;
        if (!excerpt) excerpt = article.excerpt;
        parts.push(article.body);
      }
    } else if (type === 'FAQPage') {
      const faq = describeFaq(obj);
      if (faq) parts.push(faq);
    }
  }

  if (parts.length === 0) return null;

  const content = collapseWhitespace(parts.join('\n\n'));
  if (!content) return null;

  if (!title) {
    title =
      doc.querySelector('title')?.textContent?.trim() ||
      doc.querySelector('h1')?.textContent?.trim() ||
      'Product';
  }

  return { title, content, excerpt };
}

function describeProduct(obj: Record<string, unknown>): {
  title: string;
  body: string;
  excerpt: string | null;
} | null {
  const name = pickString(obj['name']);
  if (!name) return null;

  const description = pickString(obj['description']);
  const brand = pickNamed(obj['brand']);
  const category = pickString(obj['category']);
  const sku = pickString(obj['sku']);

  const offer = pickFirstOffer(obj['offers']);
  const priceParts: string[] = [];
  if (offer) {
    if (offer.price) {
      priceParts.push(
        offer.currency ? `Price: ${offer.price} ${offer.currency}` : `Price: ${offer.price}`
      );
    }
    if (offer.availability) priceParts.push(`Availability: ${offer.availability}`);
  }

  const ratingValue = pickString(extractNested(obj, ['aggregateRating', 'ratingValue']));
  const ratingCount = pickString(extractNested(obj, ['aggregateRating', 'reviewCount'])) ??
    pickString(extractNested(obj, ['aggregateRating', 'ratingCount']));
  const ratingPart = ratingValue
    ? `Rating: ${ratingValue}${ratingCount ? ` (${ratingCount} reviews)` : ''}`
    : null;

  const lines: string[] = [`Product: ${name}`];
  if (brand) lines.push(`Brand: ${brand}`);
  if (category) lines.push(`Category: ${category}`);
  if (sku) lines.push(`SKU: ${sku}`);
  for (const p of priceParts) lines.push(p);
  if (ratingPart) lines.push(ratingPart);
  if (description) lines.push('', description);

  return {
    title: name,
    body: lines.join('\n'),
    excerpt: description ?? null,
  };
}

function describeArticle(obj: Record<string, unknown>): {
  title: string;
  body: string;
  excerpt: string | null;
} | null {
  const headline = pickString(obj['headline']) ?? pickString(obj['name']);
  if (!headline) return null;
  const description = pickString(obj['description']);
  const body = pickString(obj['articleBody']) ?? description ?? '';
  if (!body && !description) return null;
  return {
    title: headline,
    body: [headline, description, body].filter(Boolean).join('\n\n'),
    excerpt: description ?? null,
  };
}

function describeFaq(obj: Record<string, unknown>): string | null {
  const entities = obj['mainEntity'];
  if (!Array.isArray(entities)) return null;
  const lines: string[] = [];
  for (const entry of entities) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const q = pickString(e['name']);
    const a = pickString(extractNested(e, ['acceptedAnswer', 'text']));
    if (q && a) lines.push(`Q: ${q}\nA: ${a}`);
  }
  return lines.length > 0 ? lines.join('\n\n') : null;
}

/**
 * Last-resort extractor for thin pages (e.g. product cards with minimal copy).
 * Pulls h1 + meta description + og: tags + visible body text.
 */
function extractFallback(
  doc: Document,
  url: string
): { title: string; content: string; excerpt: string | null } | null {
  const title =
    doc.querySelector('h1')?.textContent?.trim() ||
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ||
    doc.querySelector('title')?.textContent?.trim() ||
    new URL(url).pathname;

  const metaDesc =
    doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ||
    doc.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ||
    null;

  // Strip noise then pull visible text from the main content region.
  for (const sel of ['script', 'style', 'noscript', 'svg', 'header', 'footer', 'nav', 'aside']) {
    for (const node of doc.querySelectorAll(sel)) node.remove();
  }

  const main =
    doc.querySelector('main') ??
    doc.querySelector('article') ??
    doc.querySelector('[role="main"]') ??
    doc.body;

  const bodyText = main ? collapseWhitespace(main.textContent ?? '') : '';
  const content = collapseWhitespace(
    [title, metaDesc, bodyText].filter(Boolean).join('\n\n')
  );

  if (!content) return null;
  return { title, content, excerpt: metaDesc };
}

function finalize(input: {
  title: string;
  content: string;
  excerpt: string | null;
}): ExtractedArticle {
  return {
    title: input.title.slice(0, MAX_TITLE_LEN),
    content: input.content.slice(0, MAX_CONTENT_LEN),
    excerpt: input.excerpt,
    wordCount: wordCount(input.content),
  };
}

function wordCount(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function collectJsonLdNodes(parsed: unknown, sink: unknown[]): void {
  if (!parsed) return;
  if (Array.isArray(parsed)) {
    for (const item of parsed) collectJsonLdNodes(item, sink);
    return;
  }
  if (typeof parsed !== 'object') return;
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj['@graph'])) {
    for (const item of obj['@graph']) collectJsonLdNodes(item, sink);
  }
  if ('@type' in obj) sink.push(obj);
}

function normalizeType(t: unknown): string | null {
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) {
    const first = t.find((x) => typeof x === 'string');
    return typeof first === 'string' ? first : null;
  }
  return null;
}

function pickString(v: unknown): string | null {
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof v === 'number') return String(v);
  return null;
}

function pickNamed(v: unknown): string | null {
  if (typeof v === 'string') return pickString(v);
  if (v && typeof v === 'object') {
    return pickString((v as Record<string, unknown>)['name']);
  }
  return null;
}

function pickFirstOffer(
  v: unknown
): { price: string | null; currency: string | null; availability: string | null } | null {
  if (!v) return null;
  const offer = Array.isArray(v) ? v[0] : v;
  if (!offer || typeof offer !== 'object') return null;
  const o = offer as Record<string, unknown>;
  return {
    price: pickString(o['price']) ?? pickString(o['lowPrice']),
    currency: pickString(o['priceCurrency']),
    availability:
      pickString(o['availability'])?.replace(/^https?:\/\/schema\.org\//, '') ?? null,
  };
}

function extractNested(obj: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function extractInternalLinksFromDoc(doc: Document, baseUrl: string): string[] {
  // Returns every absolute http(s) link on the page. Same-site filtering
  // happens in the crawler (which uses the lenient `isSameSite` check so
  // `www.example.com` and `example.com` are treated as one site).
  const seen = new Set<string>();
  for (const a of doc.querySelectorAll('a[href]')) {
    const raw = a.getAttribute('href');
    if (!raw) continue;
    try {
      const target = new URL(raw, baseUrl);
      if (target.protocol !== 'http:' && target.protocol !== 'https:') continue;
      target.hash = '';
      seen.add(target.toString());
    } catch {
      // ignore malformed hrefs
    }
  }
  return [...seen];
}
