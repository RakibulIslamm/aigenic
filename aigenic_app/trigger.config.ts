import { defineConfig } from '@trigger.dev/sdk/v3';

// Project ID is set after running `npx trigger.dev init` against the
// Trigger.dev account; we read it from env so it can differ per environment.
// Falls back to a placeholder so `next build` doesn't fail on local dev when
// Trigger.dev hasn't been provisioned yet.
const project = process.env.TRIGGER_PROJECT_REF ?? 'proj_qtdnwbwgrzbuinukihkb';

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
