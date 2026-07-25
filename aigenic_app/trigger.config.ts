import { config } from 'dotenv';
import { defineConfig } from '@trigger.dev/sdk/v3';

// The Trigger.dev CLI loads this file with a plain require() — outside
// Next's env pipeline and outside the app's `@/*` tsconfig alias resolution
// — so it must stay self-contained: own dotenv load, direct process.env
// reads, no lib/env import (lib/env pulls in `@/lib/log`, which the CLI
// cannot resolve). Same deliberate exception as drizzle.config.ts.
config({ path: '.env.local' });
config({ path: '.env', override: false });

// The env var wins so the ref can differ per environment, but the literal
// fallback must stay: this file is re-imported inside Trigger.dev's remote
// build container, where .env.local doesn't exist — a bare env read (or a
// throw on absence) fails the deploy at the indexing step. The ref is an
// identifier, not a secret; it's visible in every dashboard URL.
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
