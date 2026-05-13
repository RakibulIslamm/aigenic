import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ExternalLink } from 'lucide-react';
import { requireUserId } from '@/lib/auth/user';
import { getSiteForUser, getSiteStats } from '@/lib/sites/queries';
import { KbStatusBadge } from '../../_components/kb-status-badge';
import { CrawlProgress } from '../../_components/crawl-progress';
import { TabNav } from './_components/tab-nav';

export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const userId = await requireUserId();
  const site = await getSiteForUser(siteId, userId);
  if (!site) {
    notFound();
  }

  const isCrawling = site.kbStatus === 'pending' || site.kbStatus === 'crawling';
  // Only pay for the count query while a crawl is in flight — when the KB is
  // ready/failed the banner doesn't render anyway.
  const liveCount = isCrawling ? (await getSiteStats(siteId)).articleCount : undefined;

  return (
    <div className="flex flex-col gap-6">
      <CrawlProgress status={site.kbStatus} pageCount={liveCount} />

      <div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          All sites
        </Link>
      </div>

      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate font-serif text-3xl tracking-tight md:text-4xl">
              {site.name}
            </h1>
            <KbStatusBadge status={site.kbStatus} />
          </div>
          <a
            href={site.domain}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
          >
            {site.domain}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </header>

      <TabNav siteId={site.id} />

      <div className="pt-2">{children}</div>
    </div>
  );
}
