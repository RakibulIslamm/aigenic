import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isProtectedRoute = createRouteMatcher(['/dashboard(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

// Skip the public, auth-less surfaces: widget endpoints (called from arbitrary
// origins by the embed bubble), the scraper webhook, the Stripe webhook, and
// the health check uptime monitors poll, and the preview-only debug routes.
// Each of these used to pay a Clerk round trip on every request.
export const config = {
  matcher: [
    '/((?!_next|api/widget|api/scraper|api/stripe/webhook|api/health|api/debug|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(trpc)(.*)',
  ],
};
