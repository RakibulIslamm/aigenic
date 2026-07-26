'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CrawlEvent, CrawlSnapshot } from '@/lib/sites/crawl-events';
import { isTerminalStatus } from '@/lib/sites/status';

const EVENT_HISTORY_CAP = 30;
const RECONNECT_DELAY_MS = 1500;
// Coalesce `router.refresh()` calls so a burst of SSE messages doesn't trigger
// a refetch storm; the SSE server polls at 1.5s anyway so this just clips the
// upper bound when several deltas land back-to-back (e.g. a fast crawl).
const REFRESH_THROTTLE_MS = 800;

type ServerMessage =
  | { type: 'snapshot'; snapshot: CrawlSnapshot }
  | { type: 'events'; events: CrawlEvent[]; snapshot: CrawlSnapshot }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface UseSiteEventsResult {
  snapshot: CrawlSnapshot | null;
  events: CrawlEvent[];
  connected: boolean;
  error: string | null;
}

/**
 * Subscribes to the site's SSE event stream, returns the latest snapshot plus
 * a rolling history of synthesized events. Automatically reconnects when the
 * connection drops while the crawl is still in flight. When the server emits
 * `done` (status reached a terminal state and lingered), we stop reconnecting
 * AND trigger a `router.refresh()` so server components reflect the final state
 * (e.g. the article list re-fetches from the DB).
 *
 * The stream is RE-OPENED whenever the server-rendered status changes: after
 * a terminal `done` the connection is closed for good, so when the user hits
 * Resync the server components flip to `pending` while this hook — without
 * the re-open — would keep the dead crawl's snapshot forever (stale failure
 * panel, no live updates for the new crawl, reload required to see reality).
 */
export function useSiteEvents(
  siteId: string,
  initialSnapshot?: CrawlSnapshot | null,
): UseSiteEventsResult {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<CrawlSnapshot | null>(initialSnapshot ?? null);
  const [events, setEvents] = useState<CrawlEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const lastRefreshAtRef = useRef<number>(0);
  const pendingRefreshTimerRef = useRef<number | null>(null);

  const initialStatus = initialSnapshot?.status ?? null;

  // "Adjust state when a prop changes", done during render as React docs
  // prescribe. Only the terminal → live transition restarts the stream: after
  // a crawl's `done` the connection is closed for good, so when Resync flips
  // the server-rendered status back to `pending` we must rebase on the fresh
  // server truth, drop the finished attempt's event log, and bump `session`
  // so the effect re-opens the stream. The OTHER direction (live → terminal)
  // deliberately does nothing — the stream is still open and about to deliver
  // the terminal event itself; restarting here raced it and ate the
  // "Crawl failed" entry.
  const [seenStatus, setSeenStatus] = useState<string | null>(initialStatus);
  const [session, setSession] = useState(0);
  if (seenStatus !== initialStatus) {
    setSeenStatus(initialStatus);
    if (
      seenStatus !== null &&
      isTerminalStatus(seenStatus) &&
      initialStatus !== null &&
      !isTerminalStatus(initialStatus)
    ) {
      setSnapshot(initialSnapshot ?? null);
      setError(null);
      setEvents([]);
      setSession((s) => s + 1);
    }
  }

  useEffect(() => {
    stoppedRef.current = false;

    // Throttled invalidation of server components — every SSE update should be
    // reflected in the surrounding page (article counts, badges, lists) so the
    // UI stays in lockstep with what the crawler has done.
    const scheduleRefresh = () => {
      if (stoppedRef.current) return;
      const now = Date.now();
      const elapsed = now - lastRefreshAtRef.current;
      if (elapsed >= REFRESH_THROTTLE_MS) {
        lastRefreshAtRef.current = now;
        router.refresh();
        return;
      }
      if (pendingRefreshTimerRef.current != null) return;
      pendingRefreshTimerRef.current = window.setTimeout(() => {
        pendingRefreshTimerRef.current = null;
        if (stoppedRef.current) return;
        lastRefreshAtRef.current = Date.now();
        router.refresh();
      }, REFRESH_THROTTLE_MS - elapsed);
    };

    const connect = () => {
      if (stoppedRef.current) return;
      const url = `/api/sites/${siteId}/events`;
      const source = new EventSource(url);
      sourceRef.current = source;

      source.onopen = () => {
        setConnected(true);
        setError(null);
      };

      source.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }

        if (msg.type === 'snapshot') {
          setSnapshot(msg.snapshot);
          scheduleRefresh();
          return;
        }
        if (msg.type === 'events') {
          setSnapshot(msg.snapshot);
          setEvents((prev) => [...prev, ...msg.events].slice(-EVENT_HISTORY_CAP));
          scheduleRefresh();
          return;
        }
        if (msg.type === 'error') {
          setError(msg.message);
          return;
        }
        if (msg.type === 'done') {
          stoppedRef.current = true;
          source.close();
          setConnected(false);
          // Force-flush a final refresh — bypass the throttle so the terminal
          // state lands immediately (article list, KB status badge, etc.).
          if (pendingRefreshTimerRef.current != null) {
            window.clearTimeout(pendingRefreshTimerRef.current);
            pendingRefreshTimerRef.current = null;
          }
          lastRefreshAtRef.current = Date.now();
          router.refresh();
        }
      };

      source.onerror = () => {
        setConnected(false);
        source.close();
        sourceRef.current = null;
        if (stoppedRef.current) return;
        // Don't reconnect if we already know the crawl finished — the server
        // hangs up on terminal states after a short linger.
        if (snapshot && isTerminalStatus(snapshot.status)) {
          stoppedRef.current = true;
          return;
        }
        reconnectTimerRef.current = window.setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();

    return () => {
      stoppedRef.current = true;
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (pendingRefreshTimerRef.current != null) {
        window.clearTimeout(pendingRefreshTimerRef.current);
        pendingRefreshTimerRef.current = null;
      }
      sourceRef.current?.close();
      sourceRef.current = null;
    };
    // We intentionally don't depend on `snapshot` — the effect would tear
    // down and re-establish the SSE connection on every update otherwise.
    // `session` IS a dependency: it increments exactly when a closed stream
    // must be re-opened for a new crawl attempt (see the render-phase
    // adjustment above), and never mid-crawl.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, router, session]);

  return { snapshot, events, connected, error };
}
