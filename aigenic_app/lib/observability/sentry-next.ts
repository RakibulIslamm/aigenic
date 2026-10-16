import * as Sentry from '@sentry/nextjs';
import { setErrorReporter, type LogFields } from '@/lib/log';
import { scrubBreadcrumb, scrubEvent } from './scrub';

/**
 * Sentry for the Next.js app: server, edge and browser all start here, so
 * the privacy settings are identical everywhere (SRS NFR-REL-4, FR-PRIV-6).
 *
 * Off unless NEXT_PUBLIC_SENTRY_DSN is set — local dev and CI send nothing.
 * The DSN is public by design (it's in every browser bundle), so one
 * NEXT_PUBLIC_ variable serves server and client alike.
 *
 * Errors only: performance tracing stays off to keep within the free plan.
 */

type Runtime = 'server' | 'edge' | 'client';

let started = false;

export function sentryDsn(): string | undefined {
  // Literal read so Next inlines it into the browser bundle.
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  return dsn && dsn.trim() !== '' ? dsn.trim() : undefined;
}

export function sentryEnvironment(): string {
  return (
    process.env.NEXT_PUBLIC_VERCEL_ENV ??
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV ??
    'development'
  );
}

export function initSentry(runtime: Runtime): void {
  const dsn = sentryDsn();
  if (started || !dsn) return;
  started = true;

  Sentry.init({
    dsn,
    environment: sentryEnvironment(),
    release:
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
    initialScope: { tags: { runtime } },
  });

  setErrorReporter(reportToSentry);
}

/** `log.error(...)` → Sentry. An Error in the fields becomes the exception. */
function reportToSentry(message: string, fields?: LogFields): void {
  const cause = findError(fields);
  if (cause) {
    Sentry.captureException(cause, { extra: { message, ...withoutErrors(fields) } });
  } else {
    Sentry.captureMessage(message, { level: 'error', extra: fields });
  }
}

function findError(fields?: LogFields): Error | undefined {
  if (!fields) return undefined;
  for (const value of Object.values(fields)) {
    if (value instanceof Error) return value;
  }
  return undefined;
}

function withoutErrors(fields?: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (!(value instanceof Error)) out[key] = value;
  }
  return out;
}
