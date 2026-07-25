'use client';

import { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  FilePlus,
  Hourglass,
  Loader2,
  Octagon,
} from 'lucide-react';
import { useSiteEvents } from '@/lib/sites/use-site-events';
import type { CrawlEvent, CrawlSnapshot } from '@/lib/sites/crawl-events';

const VISIBLE_EVENTS = 8;

const KIND_META: Record<
  CrawlEvent['kind'],
  { icon: typeof Loader2; tone: string; label: string }
> = {
  queued: { icon: Hourglass, tone: 'text-muted-foreground', label: 'Queued' },
  crawling: { icon: Loader2, tone: 'text-amber-500', label: 'Crawling' },
  articles: { icon: FilePlus, tone: 'text-foreground', label: 'Indexed' },
  complete: { icon: CheckCircle2, tone: 'text-emerald-500', label: 'Complete' },
  failed: { icon: AlertTriangle, tone: 'text-red-500', label: 'Failed' },
  stopped: { icon: Octagon, tone: 'text-muted-foreground', label: 'Stopped' },
};

export function CrawlActivityFeed({
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

  const { events, snapshot, connected, error } = useSiteEvents(siteId, initialSnapshot);

  const status = snapshot?.status ?? initialStatus;
  const isLive = status === 'pending' || status === 'crawling';

  const visible = useMemo(() => events.slice(-VISIBLE_EVENTS).reverse(), [events]);

  // Hide the feed when there's nothing to show and the crawl isn't running.
  if (!isLive && visible.length === 0 && !error) return null;

  return (
    <section className="rounded-xl border border-border/60 bg-card/30 p-4">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CircleDashed
            className={`h-4 w-4 ${connected ? 'text-emerald-500' : 'text-muted-foreground'}`}
          />
          <h3 className="text-sm font-medium">Crawl activity</h3>
        </div>
        <span className="text-xs text-muted-foreground">
          {connected ? 'Live · 1.5s' : isLive ? 'Reconnecting…' : 'Idle'}
        </span>
      </header>

      {error && (
        <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-500">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {isLive ? 'Waiting for the first event…' : 'No recent events.'}
        </p>
      ) : (
        <ol className="space-y-2">
          {visible.map((event, i) => {
            const meta = KIND_META[event.kind];
            const Icon = meta.icon;
            const isSpinning =
              event.kind === 'crawling' ||
              (event.kind === 'articles' && i === 0 && isLive);
            return (
              <li
                key={`${event.at}-${event.kind}-${i}`}
                className="flex items-start gap-3 rounded-lg border border-border/40 bg-background/40 px-3 py-2"
              >
                <Icon
                  className={`mt-0.5 h-4 w-4 shrink-0 ${meta.tone} ${isSpinning ? 'animate-spin' : ''}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{event.message}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {meta.label} · {formatRelative(event.at)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function formatRelative(at: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}
