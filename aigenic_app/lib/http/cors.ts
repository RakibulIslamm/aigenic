import { NextResponse } from 'next/server';

/**
 * CORS toolkit for the public widget endpoints (`/api/widget/*`), which are
 * intentionally open-origin — the widget runs on arbitrary tenant sites.
 * Each route builds one instance with its allowed methods and reuses the
 * same headers for preflight, errors, and success responses.
 */
export function widgetCors(methods: string) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };

  return {
    headers,
    preflight: () => new Response(null, { status: 204, headers }),
    jsonError: (
      error: string,
      status: number,
      extra?: Record<string, unknown>
    ) => NextResponse.json({ error, ...extra }, { status, headers }),
  };
}
