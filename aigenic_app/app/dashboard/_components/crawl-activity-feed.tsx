'use client';

import { useMemo } from 'react';
import Link from 'next/link';
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
  initialError,
  initialErrorCode,
  crawlHost,
}: {
  siteId: string;
  initialStatus: string;
  initialCount?: number;
  initialError?: string | null;
  initialErrorCode?: string | null;
  /**
   * The site's `crawl.<domain>` route, when one has been created. Its presence
   * changes what the failure panel should say: without it, a block is fixable
   * by connecting DNS; with it, the direct route is already in place and the
   * cause is something else.
   */
  crawlHost?: string | null;
}) {
  const initialSnapshot: CrawlSnapshot = {
    status: initialStatus,
    articleCount: initialCount ?? 0,
    lastSyncedAt: null,
    lastError: initialError ?? null,
    lastErrorCode: initialErrorCode ?? null,
  };

  const { events, snapshot, connected, error } = useSiteEvents(siteId, initialSnapshot);

  const status = snapshot?.status ?? initialStatus;
  const isLive = status === 'pending' || status === 'crawling';
  const articleCount = snapshot?.articleCount ?? initialCount ?? 0;
  const lastError = snapshot?.lastError ?? initialError ?? null;
  const lastErrorCode = snapshot?.lastErrorCode ?? initialErrorCode ?? null;
  const showFailure = status === 'failed' && !!lastError;

  const visible = useMemo(() => events.slice(-VISIBLE_EVENTS).reverse(), [events]);

  // Hide the feed when there's nothing to show and the crawl isn't running.
  if (!isLive && visible.length === 0 && !error && !showFailure) return null;

  return (
    <section className="rounded-xl border border-border/60 bg-card/30 p-4">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CircleDashed
            className={`h-4 w-4 ${connected ? 'text-emerald-500' : 'text-muted-foreground'}`}
          />
          <h3 className="text-sm font-medium">Crawl activity</h3>
          {isLive && (
            <span className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
              {articleCount} page{articleCount === 1 ? '' : 's'} crawled
            </span>
          )}
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

      {showFailure && (
        <CrawlFailurePanel
          siteId={siteId}
          message={lastError}
          code={lastErrorCode}
          crawlHost={crawlHost ?? null}
        />
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
            // Spin only while the crawl is actually running — a `crawling`
            // entry used to keep spinning forever after the crawl failed.
            const isSpinning =
              isLive &&
              (event.kind === 'crawling' || (event.kind === 'articles' && i === 0));
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

/**
 * The "what now?" box for a failed crawl.
 *
 * A `blocked` verdict means the site's own CDN or firewall refused us, and the
 * only person who can change that is the owner. The offer here is the DNS
 * route: connect the provider they already use and we create
 * `crawl.<domain>` pointing straight at their origin, which the crawler
 * fetches through instead of going past the edge that's blocking it.
 *
 * When that route is already active a `blocked` verdict means something else —
 * origin-level protection, or an origin that has since moved — so the panel
 * points at re-detection rather than repeating an offer already taken up.
 */
function CrawlFailurePanel({
  siteId,
  message,
  code,
  crawlHost,
}: {
  siteId: string;
  message: string;
  code: string | null;
  crawlHost: string | null;
}) {
  return (
    <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3">
      <p className="flex items-start gap-2 text-sm text-red-500">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{message}</span>
      </p>
      {code === 'blocked' && (
        <div className="mt-3 rounded-md border border-border/50 bg-background/50 px-3 py-2.5 text-xs text-muted-foreground">
          <p className="mb-1.5 font-medium text-foreground">
            How to get the crawler through
          </p>
          {crawlHost ? (
            <>
              <p className="mb-2">
                We already fetch this site through{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                  {crawlHost}
                </code>
                , so the block is happening at your origin rather than at the edge — or
                your origin address has changed since we created that record.
              </p>
              <p>
                Open{' '}
                <Link
                  href={`/dashboard/sites/${siteId}/settings`}
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  Settings → Crawler access
                </Link>{' '}
                and press <span className="text-foreground">Re-detect origin</span>, then
                retry with <span className="text-foreground">Resync all</span>.
              </p>
            </>
          ) : (
            <>
              <p className="mb-2">
                Your firewall or CDN is answering our crawler instead of letting it reach
                your pages. The quickest fix doesn&apos;t involve writing a firewall rule:
                connect your DNS provider and we&apos;ll add one record —{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                  crawl.yourdomain
                </code>{' '}
                pointing straight at your origin, unproxied — that we crawl through
                instead.
              </p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>
                  Open{' '}
                  <Link
                    href={`/dashboard/sites/${siteId}/settings`}
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    Settings → Crawler access
                  </Link>
                  .
                </li>
                <li>
                  Connect Cloudflare, Route 53, DigitalOcean, Google Cloud DNS or
                  Namecheap.
                </li>
                <li>
                  Press <span className="text-foreground">Create crawl subdomain</span>,
                  then <span className="text-foreground">Resync all</span> to retry.
                </li>
              </ol>
              <p className="mt-2">
                Nothing about your public site changes — visitors keep hitting your CDN
                exactly as before.
              </p>
            </>
          )}
        </div>
      )}
    </div>
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
