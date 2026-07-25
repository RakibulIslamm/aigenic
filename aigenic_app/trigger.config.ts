import { defineConfig } from '@trigger.dev/sdk/v3';
import { env } from './lib/env';

// Project ref comes from env so it can differ per environment. Only the
// Trigger.dev CLI reads this file — `next build` never imports it — so failing
// loudly here can't break the app build; it just stops a misconfigured
// `trigger.dev dev/deploy` run.
const project = env.TRIGGER_PROJECT_REF;
if (!project) {
  throw new Error(
    'TRIGGER_PROJECT_REF is not set. Add it to .env.local (see .env.local.example) or pass --project-ref.',
  );
}

export default defineConfig({
  project,
  dirs: ['./trigger'],
  runtime: 'node',
  logLevel: 'log',
  // Top-level cap; per-task `maxDuration` can override.
  maxDuration: 3600,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 30_000,
      factor: 2,
      randomize: true,
    },
  },
});
