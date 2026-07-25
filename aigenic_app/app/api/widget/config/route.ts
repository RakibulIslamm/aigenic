import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { sites } from '@/db/schema';
import { DEFAULT_WIDGET_CONFIG } from '@/lib/sites/schemas';
import { widgetCors } from '@/lib/http/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const cors = widgetCors('GET, OPTIONS');

const siteIdSchema = z.string().uuid();

export function OPTIONS() {
  return cors.preflight();
}

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get('siteId');
  if (!siteIdSchema.safeParse(siteId).success) {
    return cors.jsonError('Missing or invalid siteId', 400);
  }

  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId!),
    columns: { id: true, name: true, widgetConfig: true, kbStatus: true },
  });

  if (!site) {
    return cors.jsonError('Site not found', 404);
  }

  const widgetConfig = site.widgetConfig ?? DEFAULT_WIDGET_CONFIG;

  return NextResponse.json(
    {
      siteId: site.id,
      siteName: site.name,
      botName: widgetConfig.botName,
      greeting: widgetConfig.greeting,
      primaryColor: widgetConfig.primaryColor,
      kbReady: site.kbStatus === 'ready',
    },
    {
      status: 200,
      headers: {
        ...cors.headers,
        // Cache at the edge briefly so the widget config endpoint doesn't
        // hammer the DB on every page load. Clients see fresh data within ~60s
        // of saving in the dashboard.
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    },
  );
}
