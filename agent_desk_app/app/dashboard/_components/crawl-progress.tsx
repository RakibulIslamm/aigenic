'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Polls server state every 5s while the KB is still building. Calls
 * router.refresh() to re-fetch server data without a full reload, then stops
 * once the status leaves the in-progress states.
 */
export function CrawlProgress({ status }: { status: string }) {
  const router = useRouter();
  const stoppedRef = useRef(false);

  useEffect(() => {
    const isInProgress = status === 'pending' || status === 'crawling';
    if (!isInProgress || stoppedRef.current) return;

    const interval = window.setInterval(() => {
      router.refresh();
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [router, status]);

  return null;
}
