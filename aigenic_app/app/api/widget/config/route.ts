import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { sites } from '@/db/schema';
import { DEFAULT_WIDGET_CONFIG } from '@/lib/sites/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get('siteId');
  if (!siteId || !UUID_RE.test(siteId)) {
    return NextResponse.json(
      { error: 'Missing or invalid siteId' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { id: true, name: true, widgetConfig: true, kbStatus: true },
  });

  if (!site) {
    return NextResponse.json(
      { error: 'Site not found' },
      { status: 404, headers: CORS_HEADERS }
    );
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
        ...CORS_HEADERS,
        // Cache at the edge briefly so the widget config endpoint doesn't
        // hammer the DB on every page load. Clients see fresh data within ~60s
        // of saving in the dashboard.
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    }
  );
}
