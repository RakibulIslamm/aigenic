import { z } from 'zod';
import { log } from '@/lib/log';

/**
 * Centralized environment access. Every server-side `process.env` read in
 * `app/` and `lib/` goes through the typed `env` object below, and the
 * "is this optional integration wired up?" checks live here — one
 * definition, no per-module drift.
 *
 * Validation is deliberately soft: nothing throws at import time. Optional
 * integrations (Stripe, Trigger.dev, scraper, Resend) degrade to
 * `isXConfigured() === false`; hard requirements fail loudly at first use
 * with a clear message (see `db/index.ts` for DATABASE_URL). A
 * present-but-malformed environment logs a warning instead of crashing the
 * build.
 *
 * `NEXT_PUBLIC_*` vars are read as literal `process.env.NEXT_PUBLIC_X`
 * expressions so Next's bundler can statically inline them client-side;
 * this module is the single place their fallback strategy lives.
 *
 * Deliberate exceptions that keep reading `process.env` directly:
 * `drizzle.config.ts` and `trigger.config.ts` (CLI-loaded files with their
 * own dotenv load order, outside the `@/*` alias resolution) and the
 * literal `NEXT_PUBLIC_*` reads below.
 */

const serverSchema = z.object({
  // Required at runtime — but validated at first use in db/index.ts, not
  // here, so `next build` and non-DB routes never trip over it.
  DATABASE_URL: z.string().min(1).optional(),

  // OpenRouter (the chat endpoint 503s cleanly when absent)
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_BASE_URL: z.string().min(1).default('https://openrouter.ai/api/v1'),

  // Resend escalation email
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_ADDRESS: z
    .string()
    .min(1)
    .default('Aigenic <agent@notifications.aigenic.app>'),

  // VPS scraper service
  SCRAPER_API_URL: z.string().min(1).optional(),
  SCRAPER_API_KEY: z.string().min(1).optional(),
  /**
   * The crawler's stable egress IP (the VPS's public address). Shown in the
   * "your firewall blocked us" panel so site owners can allowlist by IP as
   * well as by the AigenicBot User-Agent. Purely informational — nothing
   * breaks when unset; the panel just omits the IP line.
   */
  SCRAPER_EGRESS_IP: z.string().min(1).optional(),

  // Trigger.dev — TRIGGER_SECRET_KEY is the SDK's name; TRIGGER_API_KEY is
  // this repo's legacy alias. TRIGGER_PROJECT_REF is read by the Trigger CLI
  // via trigger.config.ts.
  TRIGGER_SECRET_KEY: z.string().min(1).optional(),
  TRIGGER_API_KEY: z.string().min(1).optional(),
  TRIGGER_API_URL: z.string().min(1).optional(),
  TRIGGER_PROJECT_REF: z.string().min(1).optional(),

  // Stripe billing
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_STARTER_PRICE_ID: z.string().min(1).optional(),
  STRIPE_PRO_PRICE_ID: z.string().min(1).optional(),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

/** `KEY=` in a dotenv file arrives as '' — treat that the same as unset. */
function emptyToUndefined(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = value === '' ? undefined : value;
  }
  return out;
}

const parsed = serverSchema.safeParse(emptyToUndefined(process.env));
if (!parsed.success) {
  log.warn('[env] Invalid environment configuration — falling back to defaults', {
    issues: parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; '),
  });
}
const server = parsed.success ? parsed.data : serverSchema.parse({});

// Literal reads — Next inlines these expressions into client bundles.
const NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL;
const NEXT_PUBLIC_WIDGET_URL = process.env.NEXT_PUBLIC_WIDGET_URL;

export const env = {
  ...server,
  /**
   * Raw public origin, undefined when unset. Browser-facing redirects (the
   * Stripe checkout/portal return URLs) prefer the incoming request origin
   * over the localhost default — use `env.NEXT_PUBLIC_APP_URL ?? requestOrigin`
   * there; everywhere else use `env.appUrl`.
   */
  NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_WIDGET_URL,
  /** Canonical app origin for server-side use; local dev default. */
  appUrl: NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  /** Origin the widget embed snippet points at; falls back to the app origin. */
  widgetUrl: NEXT_PUBLIC_WIDGET_URL ?? NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
};

/** True when the app can dispatch crawls to (and stop them on) the VPS scraper. */
export function isScraperConfigured(): boolean {
  return Boolean(env.SCRAPER_API_URL && env.SCRAPER_API_KEY);
}

/**
 * True when the app has credentials to `.trigger()` Trigger.dev tasks.
 * Callers branch on this and fall back to a synchronous dispatch when false.
 */
export function isTriggerConfigured(): boolean {
  return Boolean(env.TRIGGER_SECRET_KEY ?? env.TRIGGER_API_KEY);
}

/** True when at least one paid plan has a Stripe price configured. */
export function isStripeConfigured(): boolean {
  return Boolean(
    env.STRIPE_SECRET_KEY && (env.STRIPE_PRO_PRICE_ID ?? env.STRIPE_STARTER_PRICE_ID),
  );
}
