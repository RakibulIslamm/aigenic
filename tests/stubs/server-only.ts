// Stand-in for the `server-only` package, which throws when imported outside
// a React Server Component. Aliased in vitest.config.ts so modules guarded by
// it (e.g. lib/sites/crawl-events.ts) can be unit-tested directly.
export {};
