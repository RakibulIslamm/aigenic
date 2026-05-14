import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isProtectedRoute = createRouteMatcher(['/dashboard(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

// Skip the public, auth-less surfaces: widget endpoints (called from arbitrary
// origins by the embed bubble), the scraper webhook, and the Stripe webhook.
// Each of these used to pay a Clerk round trip on every request.
export const config = {
  matcher: [
    '/((?!_next|api/widget|api/scraper|api/stripe/webhook|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(trpc)(.*)',
  ],
};
