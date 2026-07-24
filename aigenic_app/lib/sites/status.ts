/**
 * Crawl status constants shared by server code (crawl-events, the SSE route)
 * and the client hook (use-site-events). Keep this module import-free so it
 * can never drag `server-only` into a client bundle.
 */
const TERMINAL_STATUSES = new Set(['ready', 'failed', 'stopped']);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}
