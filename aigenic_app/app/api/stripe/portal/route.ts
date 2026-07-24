import { NextResponse, type NextRequest } from 'next/server';
import { getOrCreateUser } from '@/lib/auth/user';
import { getStripeClient } from '@/lib/billing/stripe';
import { env, isStripeConfigured } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: 'Billing is not configured on this deployment' },
      { status: 503 }
    );
  }

  let user;
  try {
    user = await getOrCreateUser();
  } catch {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  if (!user.stripeCustomerId) {
    return NextResponse.json(
      { error: 'No Stripe customer on file — start a Pro subscription first.' },
      { status: 400 }
    );
  }

  const stripe = getStripeClient()!;
  // Browser-facing redirect: prefer the incoming request origin over the
  // localhost default when NEXT_PUBLIC_APP_URL is unset (see lib/env).
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${appUrl}/dashboard/billing`,
  });

  return NextResponse.json({ url: session.url });
}
