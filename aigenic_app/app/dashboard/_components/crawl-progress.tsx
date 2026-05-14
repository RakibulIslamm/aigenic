'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

const POLL_INTERVAL_MS = 15_000;

/**
 * While the KB is mid-build:
 *  • polls the server every 15 s so the page count + status reflect reality
 *    (skipped if the tab isn't visible — backgrounded tabs shouldn't hammer
 *    the dashboard's queries)
 *  • renders a thin banner so the user knows work is happening and how far
 *    along it is.
 *
 * `pageCount` is optional because the dashboard root passes a synthetic
 * "crawling" status across multiple sites and doesn't have a single count.
 */
export function CrawlProgress({
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
