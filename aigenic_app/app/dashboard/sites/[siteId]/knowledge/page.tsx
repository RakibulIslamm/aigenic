import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { requireUserId } from '@/lib/auth/user';
import { getSiteForUser, listArticlesForSitePaged } from '@/lib/sites/queries';
import { KB_PAGE_SIZE } from '@/lib/sites/limits';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ResyncAllButton,
  RescrapeArticleButton,
} from '../_components/rescrape-buttons';
import { ArticleSearch } from './_components/article-search';

/** Characters of article content shown in a row's collapsed preview. */
const ARTICLE_PREVIEW_CHARS = 240;

export default async function KnowledgeBasePage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { siteId } = await params;
  const { page: pageParam, q: queryParam } = await searchParams;
  const userId = await requireUserId();
  const site = await getSiteForUser(siteId, userId);
  if (!site) notFound();

  const requestedPage = Number.parseInt(pageParam ?? '1', 10);
  const trimmedQ = queryParam?.trim() ?? '';
  const { rows, total, page, totalPages } = await listArticlesForSitePaged(siteId, {
    page: Number.isFinite(requestedPage) ? requestedPage : 1,
    pageSize: KB_PAGE_SIZE,
    q: trimmedQ || undefined,
  });

  const rangeStart = total === 0 ? 0 : (page - 1) * KB_PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * KB_PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-heading text-2xl tracking-tight">Knowledge base</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {trimmedQ ? (
              <>
                {total} match{total === 1 ? '' : 'es'} for{' '}
                <span className="font-medium text-foreground">&ldquo;{trimmedQ}&rdquo;</span>
              </>
            ) : (
              <>
                {total} page{total === 1 ? '' : 's'} indexed from{' '}
                <span className="font-medium text-foreground">{new URL(site.domain).hostname}</span>.
                {site.kbLastSyncedAt &&
                  ` Last synced ${formatDistanceToNow(site.kbLastSyncedAt, { addSuffix: true })}.`}
              </>
            )}
          </p>
        </div>
        <ResyncAllButton siteId={siteId} kbStatus={site.kbStatus} />
      </section>

      <ArticleSearch urlQuery={trimmedQ} />

      {rows.length === 0 ? (
        trimmedQ ? (
          <NoMatchesState siteId={siteId} query={trimmedQ} />
        ) : (
          <EmptyState siteId={siteId} status={site.kbStatus} />
        )
      ) : (
        <>
          <ul className="grid gap-3">
            {rows.map((article) => (
              <li key={article.id}>
                <Card className="group border-border/60 bg-card/40 transition hover:border-border">
                  <CardContent className="px-4! py-4 sm:px-6!">
                    {/* Stack on phones (title block on top, action on its own row at the right);
                        switch to side-by-side at sm+. */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{article.title}</h3>
                          {article.sourceUrl && (
                            <a
                              href={article.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex shrink-0 items-center text-muted-foreground transition hover:text-foreground"
                              title={article.sourceUrl}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 wrap-break-word text-xs text-muted-foreground">
                          {article.content.slice(0, ARTICLE_PREVIEW_CHARS)}
                          {article.content.length > ARTICLE_PREVIEW_CHARS ? '…' : ''}
                        </p>
                      </div>
                      {/* On phones: own row, right-aligned, always visible.
                          On pointer devices (sm+): fades in on hover. */}
                      <div className="-mr-2 flex shrink-0 justify-end sm:m-0 sm:opacity-0 sm:transition sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        <RescrapeArticleButton siteId={siteId} articleId={article.id} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <Pagination
              siteId={siteId}
              page={page}
              totalPages={totalPages}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              total={total}
              query={trimmedQ}
            />
          )}
        </>
      )}
    </div>
  );
}

function Pagination({
  siteId,
  page,
  totalPages,
  rangeStart,
  rangeEnd,
  total,
  query,
}: {
  siteId: string;
  page: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
  total: number;
  query?: string;
}) {
  const basePath = `/dashboard/sites/${siteId}/knowledge`;
  const qParam = query ? `&q=${encodeURIComponent(query)}` : '';
  const prevHref = page > 2 ? `${basePath}?page=${page - 1}${qParam}` : query ? `${basePath}?q=${encodeURIComponent(query)}` : basePath;
  const nextHref = `${basePath}?page=${page + 1}${qParam}`;

  return (
    <nav
      aria-label="Knowledge base pagination"
      className="flex flex-col items-center justify-between gap-3 border-t border-border/60 pt-4 text-sm sm:flex-row"
    >
      <p className="text-xs text-muted-foreground">
        Showing <span className="font-medium text-foreground">{rangeStart}–{rangeEnd}</span> of{' '}
        <span className="font-medium text-foreground">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button
          asChild={page > 1}
          variant="outline"
          size="sm"
          disabled={page <= 1}
          className="gap-1"
        >
          {page > 1 ? (
            <Link href={prevHref}>
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Link>
          ) : (
            <span>
              <ChevronLeft className="h-4 w-4" />
              Previous
            </span>
          )}
        </Button>
        <span className="px-2 text-xs text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <Button
          asChild={page < totalPages}
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          className="gap-1"
        >
          {page < totalPages ? (
            <Link href={nextHref}>
              Next
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span>
              Next
              <ChevronRight className="h-4 w-4" />
            </span>
          )}
        </Button>
      </div>
    </nav>
  );
}

function EmptyState({ siteId, status }: { siteId: string; status: string }) {
  return (
    <Card className="border-dashed border-border/60 bg-card/20">
      <CardHeader className="items-center text-center">
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-border/60 bg-background">
          <BookOpen className="h-5 w-5" />
        </div>
        <CardTitle className="font-heading text-2xl tracking-tight">
          {status === 'crawling' || status === 'pending'
            ? 'Crawling your site'
            : status === 'failed'
              ? 'Crawl failed'
              : 'No pages yet'}
        </CardTitle>
        <CardDescription className="max-w-md">
          {status === 'crawling' || status === 'pending'
            ? 'Pages will appear here as the crawler finds them. A small marketing site finishes in a few minutes; a larger e-commerce or docs site can take longer.'
            : status === 'failed'
              ? 'The scraper couldn\'t finish. Hit "Resync all" to try again, or check the URL and try once more.'
              : 'Once your site is crawled, every public page will land here.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center pb-8">
        <ResyncAllButton siteId={siteId} kbStatus={status} />
      </CardContent>
    </Card>
  );
}

function NoMatchesState({ siteId, query }: { siteId: string; query: string }) {
  return (
    <Card className="border-dashed border-border/60 bg-card/20">
      <CardHeader className="items-center text-center">
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-border/60 bg-background">
          <BookOpen className="h-5 w-5" />
        </div>
        <CardTitle className="font-heading text-2xl tracking-tight">No matches</CardTitle>
        <CardDescription className="max-w-md">
          Nothing in your knowledge base has &ldquo;{query}&rdquo; in the title. Try a shorter or broader keyword.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center pb-8">
        <Button asChild variant="outline" size="sm">
          <Link href={`/dashboard/sites/${siteId}/knowledge`}>Clear search</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
