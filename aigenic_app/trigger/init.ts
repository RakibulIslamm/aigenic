import * as Sentry from '@sentry/node';
import { tasks } from '@trigger.dev/sdk';
import { setErrorReporter, type LogFields } from '@/lib/log';
import { scrubBreadcrumb, scrubEvent } from '@/lib/observability/scrub';

/**
 * Loaded by Trigger.dev before any task runs (the `init.ts` entry point in
 * `trigger/`). Sends failed task attempts and `log.error` lines from tasks to
 * Sentry (SRS NFR-REL-4) with the same privacy scrubbing as the web app.
 *
 * Needs SENTRY_DSN in the Trigger.dev dashboard's environment variables;
 * without it this file does nothing.
 *
 * Default integrations stay off: Trigger.dev runs its own OpenTelemetry
 * instrumentation, and Sentry's would fight it for the same hooks. Plain
 * captureException is all we need.
 */

const dsn = process.env.SENTRY_DSN?.trim() || undefined;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'production',
    sendDefaultPii: false,
    defaultIntegrations: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
    initialScope: { tags: { runtime: 'trigger' } },
  });

  setErrorReporter((message: string, fields?: LogFields) => {
    const cause = Object.values(fields ?? {}).find((value) => value instanceof Error);
    if (cause) Sentry.captureException(cause, { extra: { message } });
    else Sentry.captureMessage(message, { level: 'error', extra: fields });
  });
}

tasks.onFailure(async ({ error, ctx }) => {
  if (!dsn) return;
  Sentry.captureException(error, {
    tags: {
      task: ctx.task.id,
      run: ctx.run.id,
      trigger_env: ctx.environment.type,
      attempt: String(ctx.attempt.number),
    },
  });
  // The worker can be torn down right after this hook; send before returning.
  await Sentry.flush(3_000);
});
