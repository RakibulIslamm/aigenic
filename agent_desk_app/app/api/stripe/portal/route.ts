import { NextResponse, type NextRequest } from 'next/server';
import { getOrCreateUser } from '@/lib/auth/user';
import { getStripeClient, isStripeConfigured } from '@/lib/billing/stripe';

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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${appUrl}/dashboard/billing`,
  });

  return NextResponse.json({ url: session.url });
}
