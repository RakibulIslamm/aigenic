import { configure } from '@trigger.dev/sdk/v3';

/**
 * The Trigger.dev SDK reads `TRIGGER_SECRET_KEY` by default. This project's
 * .env.local was provisioned with `TRIGGER_API_KEY` (the v3-era name), so we
 * accept both and pass whichever is set through to the SDK on first use.
 *
 * Also accepts `TRIGGER_API_URL` for self-hosted Trigger.dev instances.
 */
let configured = false;

function readTriggerKey(): string | undefined {
  return process.env.TRIGGER_SECRET_KEY || process.env.TRIGGER_API_KEY || undefined;
}

function ensureConfigured(): void {
  if (configured) return;
  const key = readTriggerKey();
  if (!key) return;
  configure({
    accessToken: key,
    baseURL: process.env.TRIGGER_API_URL || undefined,
  });
  configured = true;
}

/**
 * Returns true when the app has the credentials to call `.trigger()` against
 * Trigger.dev's API. Callers should branch on this and fall back to a
 * synchronous dispatch path when false, so the app remains usable in dev
 * setups that haven't wired up Trigger.dev yet.
 */
export function isTriggerConfigured(): boolean {
  return Boolean(readTriggerKey());
}

/**
 * Call before any `.trigger()` / `.batchTrigger()` to ensure the SDK has the
 * access token registered. No-op when not configured (caller should have
 * checked [isTriggerConfigured] first).
 */
export function ensureTriggerConfigured(): void {
  ensureConfigured();
}
