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
  crawlerIp,
  isVerified = false,
  verifyHeader,
  userAgentToken,
}: {
  siteId: string;
  initialStatus: string;
  initialCount?: number;
  initialError?: string | null;
  initialErrorCode?: string | null;
  /** The crawler's stable egress IP (SCRAPER_EGRESS_IP), for allowlist copy. */
  crawlerIp?: string | null;
  /** Whether this site's owner has proven they control the domain. */
  isVerified?: boolean;
  /** Header name carrying the crawl secret, e.g. `X-Aigenic-Verify`. */
  verifyHeader?: string;
  /** Product token in the crawler's User-Agent, e.g. `AigenicBot`. */
  userAgentToken?: string;
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
          crawlerIp={crawlerIp ?? null}
          isVerified={isVerified}
          verifyHeader={verifyHeader ?? 'X-Aigenic-Verify'}
          userAgentToken={userAgentToken ?? 'AigenicBot'}
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
 * The "what now?" box for a failed crawl. For a `blocked` verdict this is an
 * ask for permission: the owner controls the firewall that refused us, and
 * the fix is theirs to make — allow the crawler, then Resync.
 *
 * What we advise depends on whether they've proven they own the domain.
 * A verified owner gets a header rule keyed to their private crawl secret,
 * which nothing else on the internet can satisfy. An unverified one is sent
 * to verify first rather than being handed a User-Agent rule — a UA string
 * is a claim anyone can make, so telling someone to trust one is telling them
 * to open a hole for every scraper that reads this page.
 */
function CrawlFailurePanel({
  siteId,
  message,
  code,
  crawlerIp,
  isVerified,
  verifyHeader,
  userAgentToken,
}: {
  siteId: string;
  message: string;
  code: string | null;
  crawlerIp: string | null;
  isVerified: boolean;
  verifyHeader: string;
  userAgentToken: string;
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
            How to allow this app to crawl your site
          </p>
          {isVerified ? (
            <>
              <p className="mb-2">
                Every request we make to your site carries the{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                  {verifyHeader}
                </code>{' '}
                header with your site&apos;s private crawl secret
                {crawlerIp ? (
                  <>
                    , always from the IP address{' '}
                    <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                      {crawlerIp}
                    </code>
                  </>
                ) : null}
                .
              </p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>
                  Copy your crawl secret from{' '}
                  <Link
                    href={`/dashboard/sites/${siteId}/settings`}
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    Settings → Domain ownership
                  </Link>
                  .
                </li>
                <li>
                  In your firewall (on Cloudflare:{' '}
                  <span className="text-foreground">Security → WAF → Custom rules</span>
                  ), add a <span className="text-foreground">Skip</span> rule for requests
                  where the <span className="text-foreground">{verifyHeader}</span> header
                  equals that secret.
                </li>
                <li>
                  Come back and press <span className="text-foreground">Resync all</span>{' '}
                  to retry.
                </li>
              </ol>
              <p className="mt-2">
                Matching the header — rather than our{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                  {userAgentToken}
                </code>{' '}
                User-Agent — means the rule lets in only us, since nobody else has your
                secret.
              </p>
            </>
          ) : (
            <>
              <p className="mb-2">
                First,{' '}
                <Link
                  href={`/dashboard/sites/${siteId}/settings`}
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  verify you own this domain
                </Link>{' '}
                (one DNS record, a couple of minutes). That unlocks a private crawl secret
                your firewall can allow — a rule only our crawler can satisfy.
              </p>
              <p>
                We ask for proof of ownership first because the alternative — telling you
                to trust a User-Agent name — would open your site to anyone who types that
                same name.
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
