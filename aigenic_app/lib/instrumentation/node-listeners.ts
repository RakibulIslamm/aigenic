import { log } from '@/lib/log';

/**
 * Node-runtime process listeners, kept out of `instrumentation.ts` itself.
 * That file is compiled for **both** the Node and Edge runtimes, and Edge has
 * no `process.on` — a plain `if (NEXT_RUNTIME === 'nodejs')` guard is a
 * runtime check the bundler can't see, so it still fails the Edge compile.
 * Importing this module dynamically keeps it out of the Edge bundle entirely.
 */

/** `register()` re-runs under HMR; the listeners must not stack up. */
let installed = false;

export function installProcessListeners(): void {
  if (installed) return;
  installed = true;

  process.on('unhandledRejection', (reason) => {
    // Log-only, deliberately: a stray rejection from one request shouldn't
    // kill a warm instance that is serving other requests.
    log.error('[instrumentation] unhandled promise rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  process.on('uncaughtException', (err) => {
    // Log, then let the process die as it would have without this listener —
    // continuing past an uncaught exception means serving later requests from
    // a process in unknown state.
    log.error('[instrumentation] uncaught exception', {
      message: err.message,
      stack: err.stack,
    });
    process.exit(1);
  });
}
