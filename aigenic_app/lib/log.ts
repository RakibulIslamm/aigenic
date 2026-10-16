/**
 * Minimal logging seam for the app. Every log line in `app/` and `lib/`
 * flows through here. Deliberately just `console` underneath — one
 * consistent shape: a message string plus an optional structured fields
 * object.
 *
 * Errors are also forwarded to whichever error reporter the runtime
 * registered: Sentry in the Next.js server and browser
 * (`lib/observability/sentry-next.ts`), Sentry for Node in Trigger.dev tasks
 * (`trigger/init.ts`). This module stays dependency-free so it bundles
 * anywhere; with no reporter registered, `log.error` is console-only.
 *
 * Out of scope by design: the scraper keeps its pino logger and the widget
 * its bare `console.warn`.
 */

export type LogFields = Record<string, unknown>;

export type ErrorReporter = (message: string, fields?: LogFields) => void;

let reporter: ErrorReporter | null = null;

/** Called once per runtime at startup. Passing `null` detaches it (tests). */
export function setErrorReporter(next: ErrorReporter | null): void {
  reporter = next;
}

export interface ErrorOptions {
  /**
   * `false` keeps the line out of the error reporter — for call sites whose
   * error Sentry already captures itself (request errors, unhandled
   * rejections), where reporting it too would file every issue twice.
   */
  report?: boolean;
}

function write(
  method: 'info' | 'warn' | 'error',
  message: string,
  fields?: LogFields,
  report = true,
): void {
  if (fields && Object.keys(fields).length > 0) {
    console[method](message, fields);
  } else {
    console[method](message);
  }
  if (method === 'error' && report && reporter) {
    try {
      reporter(message, fields);
    } catch {
      // A broken reporter must never break the code path that was logging.
    }
  }
}

export const log = {
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields, options?: ErrorOptions) =>
    write('error', message, fields, options?.report ?? true),
};
