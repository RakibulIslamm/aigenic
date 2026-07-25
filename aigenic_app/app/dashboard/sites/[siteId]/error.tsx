'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { ErrorState } from '@/components/error-state';
import { log } from '@/lib/log';

/**
 * Per-site boundary. Sits below the dashboard one so a single broken site tab
 * (analytics query, knowledge page, settings) doesn't take out the whole
 * dashboard, and "Try again" re-fetches just this segment.
 */
export default function SiteError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const params = useParams<{ siteId: string }>();

  useEffect(() => {
    log.error('[dashboard/site] unhandled render error', {
      message: error.message,
      digest: error.digest,
      siteId: params?.siteId,
    });
  }, [error, params?.siteId]);

  return (
    <div className="py-10">
      <ErrorState
        title="Couldn't load this site"
        description="Something went wrong fetching this site's data. Try again, or go back to your list of sites."
        digest={error.digest}
        onRetry={() => unstable_retry()}
        link={{ href: '/dashboard', label: 'All sites' }}
      />
    </div>
  );
}
