'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useSiteEvents } from '@/lib/sites/use-site-events';
import type { CrawlSnapshot } from '@/lib/sites/crawl-events';

const POLL_INTERVAL_MS = 15_000;

interface CrawlProgressProps {
  status: string;
  pageCount?: number;
  // When siteId is provided we connect to the SSE event stream and update in
  // realtime (~1.5s latency). Without siteId we fall back to a 15s router
  // refresh — that's the dashboard-wide banner that aggregates many sites.
  siteId?: string;
}

export function CrawlProgress(props: CrawlProgressProps) {
  if (props.siteId) {
    return <LiveCrawlProgress siteId={props.siteId} initialStatus={props.status} initialCount={props.pageCount} />;
  }
  return <PollingCrawlProgress status={props.status} pageCount={props.pageCount} />;
}

function LiveCrawlProgress({
  siteId,
  initialStatus,
  initialCount,
}: {
  siteId: string;
  initialStatus: string;
  initialCount?: number;
}) {
  const initialSnapshot: CrawlSnapshot = {
    status: initialStatus,
    articleCount: initialCount ?? 0,
    lastSyncedAt: null,
  };
  const { snapshot, connected } = useSiteEvents(siteId, initialSnapshot);

  const status = snapshot?.status ?? initialStatus;
  const articleCount = snapshot?.articleCount ?? initialCount;
  const isInProgress = status === 'pending' || status === 'crawling';

  if (!isInProgress) return null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-sm">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {status === 'pending' ? 'Queueing crawl…' : 'Crawling your site…'}
        </p>
        <p className="text-xs text-muted-foreground">
          {typeof articleCount === 'number'
            ? `${articleCount.toLocaleString()} page${articleCount === 1 ? '' : 's'} indexed so far`
            : 'Live updates streaming'}
          {' · '}
          <span className={connected ? 'text-emerald-500' : 'text-amber-500'}>
            {connected ? 'Live' : 'Reconnecting…'}
          </span>
        </p>
      </div>
    </div>
  );
}

/**
 * Fallback used by the dashboard root, which doesn't have a single siteId.
 * Polls the page every 15s while any site is mid-crawl.
 */
function PollingCrawlProgress({
  status,
  pageCount,
}: {
  status: string;
  pageCount?: number;
}) {
  const router = useRouter();
  const isInProgress = status === 'pending' || status === 'crawling';

  useEffect(() => {
    if (!isInProgress) return;

    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      router.refresh();
    };

    const interval = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [router, isInProgress]);

  if (!isInProgress) return null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-sm">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {status === 'pending' ? 'Queueing crawl…' : 'Crawling your site…'}
        </p>
        <p className="text-xs text-muted-foreground">
          {typeof pageCount === 'number'
            ? `${pageCount.toLocaleString()} page${pageCount === 1 ? '' : 's'} indexed so far — `
            : ''}
          this page auto-refreshes every 15 seconds.
        </p>
      </div>
    </div>
  );
}
