/**
 * Minimal logging seam for the app. Every log line in `app/` and `lib/`
 * flows through here so wiring up Sentry / a log drain later (reliability
 * §7) is a one-file change, not a call-site hunt. Deliberately just
 * `console` underneath — behavior-neutral, but one consistent shape:
 * a message string plus an optional structured fields object.
 *
 * Out of scope by design: the scraper keeps its pino logger and the widget
 * its bare `console.warn`.
 */

type LogFields = Record<string, unknown>;

function write(
  method: 'info' | 'warn' | 'error',
  message: string,
  fields?: LogFields
): void {
  if (fields && Object.keys(fields).length > 0) {
    console[method](message, fields);
  } else {
    console[method](message);
  }
}

export const log = {
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
};
