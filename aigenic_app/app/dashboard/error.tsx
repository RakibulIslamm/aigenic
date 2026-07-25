'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/error-state';
import { log } from '@/lib/log';

/**
 * Dashboard-wide boundary. Renders inside `app/dashboard/layout.tsx`, so the
 * header and nav survive the failure and the user is never stranded — the
 * common cases here are a Neon cold-start timeout and an expired session
 * throwing out of `requireUserId()`.
 */
export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    log.error('[dashboard] unhandled render error', {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="py-10">
      <ErrorState
        title="Couldn't load your dashboard"
        description="We couldn't reach the database or something else broke on our side. Try again — if it keeps happening, the reference below matches our server logs."
        digest={error.digest}
        onRetry={() => unstable_retry()}
        link={{ href: '/dashboard', label: 'Back to sites' }}
      />
    </div>
  );
}
