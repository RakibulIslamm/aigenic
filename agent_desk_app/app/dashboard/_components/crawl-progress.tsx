'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const POLL_INTERVAL_MS = 15_000;

/**
 * Polls server state while the KB is still building. Calls router.refresh()
 * to re-fetch the RSC tree, then stops once the status leaves the in-progress
 * states. Skips the tick when the tab isn't visible so a backgrounded tab
 * doesn't keep hammering the dashboard's queries.
 */
export function CrawlProgress({ status }: { status: string }) {
  const router = useRouter();

  useEffect(() => {
    const isInProgress = status === 'pending' || status === 'crawling';
    if (!isInProgress) return;

    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      router.refresh();
    };

    const interval = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [router, status]);

  return null;
}
