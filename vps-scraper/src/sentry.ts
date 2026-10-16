import * as Sentry from '@sentry/node';

/**
 * Error tracking for the crawler (SRS NFR-REL-4), set up when index.ts
 * imports this module. Off unless SENTRY_DSN is set in vps-scraper/.env.
 *
 * The crawler never sees visitor data, but crawled pages can contain
 * anything, so request bodies are dropped and emails masked all the same.
 */

const dsn = process.env.SENTRY_DSN?.trim() || undefined;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export const sentryEnabled = Boolean(dsn);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    initialScope: { tags: { runtime: 'crawler' } },
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
      }
      delete event.user;
      if (event.message) event.message = event.message.replace(EMAIL, '[email]');
      for (const exception of event.exception?.values ?? []) {
        if (exception.value) exception.value = exception.value.replace(EMAIL, '[email]');
      }
      return event;
    },
  });
}

export function captureError(err: unknown, context: Record<string, string> = {}): void {
  if (!dsn) return;
  Sentry.captureException(err, { tags: context });
}

export async function flushErrors(timeoutMs = 2_000): Promise<void> {
  if (!dsn) return;
  await Sentry.flush(timeoutMs);
}
