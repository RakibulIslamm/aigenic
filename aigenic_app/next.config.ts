import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Baseline security headers for the dashboard/app (security plan 01 · Phase 5).
 * Enforced immediately: framing is denied (clickjacking), MIME sniffing off,
 * HTTPS pinned, referrers trimmed, powerful browser APIs opted out of.
 *
 * The widget API routes are deliberately EXCLUDED from the frame/CSP headers
 * (see `headers()` below): the widget lives inside arbitrary tenant pages, so
 * a dashboard-oriented framing policy must never touch `/api/widget/*`.
 *
 * NOTE (plan 03 · Phase 6): widget.js caching headers land in this same
 * `headers()` block later — merge, don't overwrite.
 */
const enforcedSecurityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  // The enforced CSP carries ONLY frame-ancestors (safe everywhere today);
  // the full policy below runs report-only until its allowlist is proven out.
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/**
 * Full CSP, REPORT-ONLY: violations show up in the browser console (and as
 * report entries) without breaking anything. Clerk injects inline/eval'd
 * scripts and Stripe needs its frames, hence the allowances. Once the console
 * is quiet across sign-in → dashboard → billing, promote this string to a
 * real `Content-Security-Policy` header (keeping `frame-ancestors 'none'`).
 * Production Clerk on a custom domain will need that host added here.
 */
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.accounts.dev https://challenges.cloudflare.com https://js.stripe.com",
  "connect-src 'self' https://*.clerk.accounts.dev https://clerk-telemetry.com https://api.stripe.com",
  "img-src 'self' data: blob: https://img.clerk.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  'frame-src https://challenges.cloudflare.com https://js.stripe.com https://hooks.stripe.com',
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  turbopack: {
    // The pnpm workspace root, not aigenic_app: pnpm hoists the real package
    // files into <repo>/node_modules/.pnpm, and Turbopack refuses to resolve
    // anything outside its root — so pointing this at aigenic_app makes every
    // dependency unresolvable.
    root: path.resolve(__dirname, '..'),
  },
  async headers() {
    return [
      {
        // Everything except the widget API: the negative lookahead keeps the
        // frame-blocking headers off the endpoints that tenant pages embed.
        source: '/((?!api/widget).*)',
        headers: [
          ...enforcedSecurityHeaders,
          { key: 'Content-Security-Policy-Report-Only', value: cspReportOnly },
        ],
      },
      {
        // Widget API: hygiene only. No framing/CSP headers, and CORS stays
        // owned by the route handlers (`lib/http/cors.ts`).
        source: '/api/widget/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
