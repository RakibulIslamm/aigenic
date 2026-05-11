import { Readability, isProbablyReaderable } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

export interface ExtractedArticle {
  title: string;
  content: string;
  excerpt: string | null;
  wordCount: number;
}

const MIN_WORDS = 40;
const MAX_CONTENT_LEN = 80_000; // protects DB row size and downstream prompts

/**
 * Pulls main article content from a rendered HTML page using Mozilla's
 * Readability. Returns null when the page isn't readable (think landing pages
 * with no real prose, login walls, etc.).
 */
export function extractContent(html: string, url: string): ExtractedArticle | null {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  if (!isProbablyReaderable(doc)) {
    return null;
  }

  const reader = new Readability(doc);
  const article = reader.parse();

  if (!article || !article.textContent) {
    return null;
  }

  const cleaned = article.textContent.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return null;

  const wordCount = cleaned.split(/\s+/).length;
  if (wordCount < MIN_WORDS) return null;

  const title =
    article.title?.trim() ||
    doc.querySelector('title')?.textContent?.trim() ||
    new URL(url).pathname;

  return {
    title: title.slice(0, 500),
    content: cleaned.slice(0, MAX_CONTENT_LEN),
    excerpt: article.excerpt?.trim() ?? null,
    wordCount,
  };
}

/**
 * Returns every same-origin `<a href>` discovered on the page. Used to expand
 * the crawl frontier without leaving the tenant's domain.
 */
export function extractInternalLinks(html: string, baseUrl: string): string[] {
  const dom = new JSDOM(html, { url: baseUrl });
  const base = new URL(baseUrl);
  const seen = new Set<string>();

  for (const a of dom.window.document.querySelectorAll('a[href]')) {
    const raw = a.getAttribute('href');
    if (!raw) continue;
    try {
      const target = new URL(raw, baseUrl);
      if (target.hostname !== base.hostname) continue;
      if (target.protocol !== 'http:' && target.protocol !== 'https:') continue;
      // Strip hash + tracking-y params for dedupe.
      target.hash = '';
      seen.add(target.toString());
    } catch {
      // ignore malformed hrefs
    }
  }

  return [...seen];
}
