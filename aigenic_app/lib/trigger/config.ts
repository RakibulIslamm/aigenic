import { configure } from '@trigger.dev/sdk/v3';
import { env, isTriggerConfigured } from '@/lib/env';

/**
 * The Trigger.dev SDK reads `TRIGGER_SECRET_KEY` by default. This project's
 * .env.local was provisioned with `TRIGGER_API_KEY` (the v3-era name), so we
 * accept both and pass whichever is set through to the SDK on first use.
 * (`isTriggerConfigured` itself lives in `lib/env` with the other derived
 * configuration checks.)
 *
 * Also accepts `TRIGGER_API_URL` for self-hosted Trigger.dev instances.
 */
let configured = false;

/**
 * Call before any `.trigger()` / `.batchTrigger()` to ensure the SDK has the
 * access token registered. No-op when not configured (caller should have
 * checked `isTriggerConfigured` first).
 */
export function ensureTriggerConfigured(): void {
  if (configured) return;
  if (!isTriggerConfigured()) return;
  configure({
    accessToken: env.TRIGGER_SECRET_KEY ?? env.TRIGGER_API_KEY,
    baseURL: env.TRIGGER_API_URL,
  });
  configured = true;
}
