import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { buildHealthReport, probeDatabase } from '@/lib/observability/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness of the app and its database, for uptime monitors (SRS 7.2,
 * NFR-REL-1). Public and cheap: one `select 1` with a 3-second cap. Answers
 * 503 when the database is unreachable so a monitor alerts on the status
 * code alone. Says nothing secret — no hostnames, no error text.
 */
export async function GET(): Promise<NextResponse> {
  const database = await probeDatabase(() => db.execute(sql`select 1`));
  const report = buildHealthReport(database, process.env);
  return NextResponse.json(report, {
    status: report.status === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
