import * as Sentry from '@sentry/nextjs';
import { initSentry } from '@/lib/observability/sentry-next';

/**
 * Browser-side error tracking. Runs before hydration, so errors during the
 * first render are caught too. A no-op when NEXT_PUBLIC_SENTRY_DSN is unset.
 */
try {
  initSentry('client');
} catch {
  // Monitoring must never stop the app from starting.
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
