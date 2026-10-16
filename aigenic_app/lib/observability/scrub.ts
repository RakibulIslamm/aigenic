/**
 * Strips personal data from error reports before they leave our servers
 * (SRS FR-PRIV-6, NFR-REL-4). Shared by every Sentry setup — the Next.js
 * server and browser, Trigger.dev tasks — so the rules can't drift.
 *
 * What goes: request bodies, cookies, query strings, every header but the
 * user agent, the user block (IP included), and email addresses and phone
 * numbers anywhere in messages, exception values, extras, tags and
 * breadcrumbs. What stays: stack traces, route names, IDs — enough to find
 * the bug, nothing that identifies a visitor.
 *
 * Typed structurally rather than against @sentry/* so this file has no
 * runtime dependency and is trivially unit-testable.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Only shapes that are clearly phone numbers: an international prefix, or
// three separated digit groups. A bare long digit run is far more often an
// ID or a timestamp, and hiding those would make reports useless.
const PHONE_INTL = /\+\d[\d\s().-]{6,}\d/g;
const PHONE_GROUPED = /\b\d{3}[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g;

const MAX_DEPTH = 5;

export function redactText(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(PHONE_INTL, '[phone]')
    .replace(PHONE_GROUPED, '[phone]');
}

function redactValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return redactText(value);
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = redactValue(inner, depth + 1);
  }
  return out;
}

interface ScrubbableRequest {
  data?: unknown;
  cookies?: unknown;
  query_string?: unknown;
  headers?: Record<string, string>;
  url?: string;
}

interface ScrubbableBreadcrumb {
  message?: string;
  data?: Record<string, unknown>;
}

export interface ScrubbableEvent {
  message?: string;
  request?: ScrubbableRequest;
  user?: unknown;
  extra?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  breadcrumbs?: ScrubbableBreadcrumb[];
  exception?: { values?: Array<{ value?: string }> };
}

const KEPT_HEADERS = new Set(['user-agent']);

export function scrubEvent<T extends ScrubbableEvent>(original: T): T {
  // Work on the structural view; the caller gets its own type back.
  const event: ScrubbableEvent = original;
  if (event.request) {
    const request = event.request;
    delete request.data;
    delete request.cookies;
    delete request.query_string;
    if (request.url) request.url = request.url.split('?')[0];
    if (request.headers) {
      const kept: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (KEPT_HEADERS.has(name.toLowerCase())) kept[name] = value;
      }
      request.headers = kept;
    }
  }
  delete event.user;
  if (event.message) event.message = redactText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redactText(exception.value);
  }
  if (event.extra) event.extra = redactValue(event.extra, 0) as Record<string, unknown>;
  if (event.tags) event.tags = redactValue(event.tags, 0) as Record<string, unknown>;
  if (event.contexts) {
    event.contexts = redactValue(event.contexts, 0) as Record<string, unknown>;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => scrubBreadcrumb(crumb));
  }
  return original;
}

export function scrubBreadcrumb<T extends ScrubbableBreadcrumb>(original: T): T {
  const crumb: ScrubbableBreadcrumb = original;
  if (crumb.message) crumb.message = redactText(crumb.message);
  if (crumb.data) crumb.data = redactValue(crumb.data, 0) as Record<string, unknown>;
  return original;
}
