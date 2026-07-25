'use client';

import { useEffect } from 'react';
import './globals.css';

/**
 * Last-resort boundary: catches throws in the **root layout itself** (Clerk
 * provider, font loading, `globals.css`), which `app/error.tsx` cannot — it
 * renders *inside* that layout.
 *
 * Because this file replaces the root layout it must ship its own `<html>` /
 * `<body>`, and it deliberately avoids `next/link`, `next/font` and the
 * shadcn components: whatever broke may well be one of them. Plain tags, an
 * explicit font stack (the `--font-*` vars come from the layout that just
 * failed), and a hard navigation only.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error('[app] root layout error', {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body
        className="min-h-screen bg-background text-foreground antialiased"
        style={{
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <title>Something went wrong — Aigenic</title>
        <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The app failed to start rendering this page. Try again — if it keeps
            happening, quote the reference below when you contact support.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => unstable_retry()}
              className="h-9 rounded-4xl bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Try again
            </button>
            {/* Deliberately a plain anchor, not next/link: the root layout
                failed to render, so a full document load is the only reliable
                way out — a client-side navigation would remount the same
                broken tree. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="h-9 rounded-4xl border border-border px-4 text-sm font-medium leading-9 transition hover:bg-muted"
            >
              Go home
            </a>
          </div>
          {error.digest && (
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
