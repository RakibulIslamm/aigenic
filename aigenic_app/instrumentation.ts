import type { Instrumentation } from 'next';
import { log } from '@/lib/log';

/**
 * Server-side observability hook. Until now nothing logged an uncaught server
 * error: a throw in a server component or action produced a client-side error
 * page and *silence* in the server logs, so there was no way to connect a
 * user report to a cause.
 *
 * Everything here goes through `lib/log` — the same seam reliability §7 will
 * point at Sentry / a log drain, which makes that a one-file change rather
 * than a rewrite of this file.
 */

export async function register(): Promise<void> {
  // Dynamic, not top-level: this file is compiled for the Edge runtime too,
  // and the listeners it installs use Node-only APIs.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { installProcessListeners } =
    await import('@/lib/instrumentation/node-listeners');
  installProcessListeners();
}

export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  const error = err as Error & { digest?: string };
  log.error('[instrumentation] request error', {
    // `digest` is what the user sees on the error boundary — logging it is
    // what makes "Reference: 1234567890" traceable back to this line.
    digest: error.digest,
    message: error.message,
    stack: error.stack,
    method: request.method,
    path: request.path,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
  });
};
