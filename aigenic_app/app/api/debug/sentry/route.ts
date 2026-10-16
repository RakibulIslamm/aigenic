import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { sentryDsn } from '@/lib/observability/sentry-next';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sends one test error to Sentry so a person can confirm error tracking works
 * on a preview deploy (task T0.1). Disabled in production, where a public URL
 * that files errors on demand would only be a way to spend our quota.
 */
export async function GET(): Promise<NextResponse> {
  if (process.env.VERCEL_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!sentryDsn()) {
    return NextResponse.json(
      { sent: false, reason: 'NEXT_PUBLIC_SENTRY_DSN is not set for this deploy.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const eventId = Sentry.captureException(
    new Error('Aigenic test error: error tracking works (T0.1)'),
    { tags: { test: 'true' } },
  );
  // Serverless functions can freeze as soon as the response is sent; flush
  // first so the event actually leaves.
  await Sentry.flush(3_000);
  return NextResponse.json(
    { sent: true, eventId },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
