'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/error-state';
import { log } from '@/lib/log';

/**
 * Catches anything that throws below the root layout but outside the
 * dashboard tree (the landing page, sign-in/up, and any future top-level
 * route). The root layout — and therefore the fonts, theme and Clerk
 * provider — still renders around this.
 */
export default function RootError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    log.error('[app] unhandled render error', {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-16 sm:px-6">
      <ErrorState
        title="Something went wrong"
        description="That page failed to load. This is usually temporary — try again, or head back home."
        digest={error.digest}
        onRetry={() => unstable_retry()}
        link={{ href: '/', label: 'Go home' }}
      />
    </main>
  );
}
