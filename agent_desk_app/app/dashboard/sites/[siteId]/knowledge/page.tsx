import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { requireUserId } from '@/lib/auth/user';
import { getSiteForUser, listArticlesForSitePaged } from '@/lib/sites/queries';
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

const PAGE_SIZE = 25;

export default async function KnowledgeBasePage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { siteId } = await params;
  const { page: pageParam } = await searchParams;
  const userId = await requireUserId();
  const site = await getSiteForUser(siteId, userId);
  if (!site) notFound();

  const requestedPage = Number.parseInt(pageParam ?? '1', 10);
  const { rows, total, page, totalPages } = await listArticlesForSitePaged(siteId, {
    page: Number.isFinite(requestedPage) ? requestedPage : 1,
    pageSize: PAGE_SIZE,
  });

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-serif text-2xl tracking-tight">Knowledge base</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} article{total === 1 ? '' : 's'} crawled from{' '}
            <span className="font-medium text-foreground">{new URL(site.domain).hostname}</span>.
            {site.kbLastSyncedAt &&
              ` Last synced ${formatDistanceToNow(site.kbLastSyncedAt, { addSuffix: true })}.`}
          </p>
        </div>
        <ResyncAllButton siteId={siteId} />
      </section>

      {rows.length === 0 ? (
        <EmptyState siteId={siteId} status={site.kbStatus} />
      ) : (
        <>
          <ul className="grid gap-3">
            {rows.map((article) => (
              <li key={article.id}>
                <Card className="border-border/60 bg-card/40">
                  <CardContent className="flex items-start justify-between gap-4 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-medium">{article.title}</h3>
                        {article.sourceUrl && (
                          <a
                            href={article.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center text-muted-foreground transition hover:text-foreground"
                            title={article.sourceUrl}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {article.content.slice(0, 240)}
                        {article.content.length > 240 ? '…' : ''}
                      </p>
                    </div>
                    <RescrapeArticleButton siteId={siteId} articleId={article.id} />
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
}: {
  siteId: string;
  page: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
  total: number;
}) {
  const basePath = `/dashboard/sites/${siteId}/knowledge`;
  const prevHref = page > 2 ? `${basePath}?page=${page - 1}` : basePath;
  const nextHref = `${basePath}?page=${page + 1}`;

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
        <CardTitle className="font-serif text-2xl tracking-tight">
          {status === 'crawling' || status === 'pending'
            ? 'Crawling your site'
            : status === 'failed'
              ? 'Crawl failed'
              : 'No articles yet'}
        </CardTitle>
        <CardDescription className="max-w-md">
          {status === 'crawling' || status === 'pending'
            ? 'Pages will appear here as the crawler finds them. This usually takes a few minutes for a small docs site.'
            : status === 'failed'
              ? 'The scraper couldn\'t finish. Hit "Resync all" to try again, or check the URL and try once more.'
              : 'Once your site is crawled, every public article will land here.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center pb-8">
        <ResyncAllButton siteId={siteId} />
      </CardContent>
    </Card>
  );
}
