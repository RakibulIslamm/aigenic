import { describe, expect, it } from 'vitest';
import { db } from '@/db';
import { articles } from '@/db/schema';
import {
  crawledArticles,
  servedArticles,
  staleCrawledArticles,
} from '@/lib/sites/generations';

/**
 * Manual documents are the part of the knowledge base no firewall can block —
 * and no crawl may touch. These render each filter to SQL and pin down the
 * `source` condition that guarantees that, since a dropped clause here would
 * either hide uploads from visitors or let the next crawl delete them.
 */

// `toSQL()` only renders — postgres-js connects lazily, so no socket opens.
const render = (where: ReturnType<typeof servedArticles>) => {
  const q = db.select({ id: articles.id }).from(articles).where(where).toSQL();
  return { sql: q.sql.slice(q.sql.indexOf(' where ')), params: q.params };
};
const SITE = '6b4d2b1a-0f3e-4a1c-9b7e-2f8c1d5a7e90';

describe('generation filters', () => {
  it('servedArticles = the active generation OR any manual document', () => {
    const q = render(servedArticles(SITE, 7));
    expect(q.sql).toMatch(/"crawl_generation" = \$\d+ or "articles"\."source" = \$\d+/);
    expect(q.params).toEqual([SITE, 7, 'manual']);
  });

  it('crawledArticles counts crawled rows only (an empty crawl stays empty)', () => {
    const q = render(crawledArticles(SITE, 8));
    expect(q.sql).toContain('"articles"."source" = $2');
    expect(q.params).toEqual([SITE, 'crawl', 8]);
  });

  it('staleCrawledArticles can never match a manual document', () => {
    const q = render(staleCrawledArticles(SITE, 7));
    expect(q.sql).toContain('"articles"."source" = $2');
    expect(q.sql).toContain('"articles"."crawl_generation" <> $3');
    expect(q.params).toEqual([SITE, 'crawl', 7]);
  });
});
