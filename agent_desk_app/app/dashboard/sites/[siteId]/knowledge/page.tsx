import { notFound } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { BookOpen, ExternalLink } from 'lucide-react';
import { requireUserId } from '@/lib/auth/user';
import { getSiteForUser, listArticlesForSite } from '@/lib/sites/queries';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ResyncAllButton,
  RescrapeArticleButton,
} from '../_components/rescrape-buttons';

export default async function KnowledgeBasePage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const userId = await requireUserId();
  const site = await getSiteForUser(siteId, userId);
  if (!site) notFound();

  const articles = await listArticlesForSite(siteId);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-serif text-2xl tracking-tight">Knowledge base</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {articles.length} article{articles.length === 1 ? '' : 's'} crawled from{' '}
            <span className="font-medium text-foreground">{new URL(site.domain).hostname}</span>.
            {site.kbLastSyncedAt &&
              ` Last synced ${formatDistanceToNow(site.kbLastSyncedAt, { addSuffix: true })}.`}
          </p>
        </div>
        <ResyncAllButton siteId={siteId} />
      </section>

      {articles.length === 0 ? (
        <EmptyState siteId={siteId} status={site.kbStatus} />
      ) : (
        <ul className="grid gap-3">
          {articles.map((article) => (
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
      )}
    </div>
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
