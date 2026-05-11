import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { getOrCreateUser } from '@/lib/auth/user';
import {
  getStripeClient,
  STRIPE_PRO_PRICE_ID,
  isStripeConfigured,
} from '@/lib/billing/stripe';

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

  if (user.plan === 'pro') {
    return NextResponse.json(
      { error: 'You\'re already on Pro. Use the customer portal to manage your subscription.' },
      { status: 400 }
    );
  }

  const stripe = getStripeClient()!;
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

  // Reuse the customer if we've ever created one for this user; otherwise
  // create a fresh one so the subscription is tied to a single Stripe Customer
  // for the lifetime of the account.
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    await db
      .update(users)
      .set({ stripeCustomerId: customerId })
      .where(eq(users.id, user.id));
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: STRIPE_PRO_PRICE_ID, quantity: 1 }],
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    success_url: `${appUrl}/dashboard/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/dashboard/billing?status=cancelled`,
    metadata: { userId: user.id },
    subscription_data: {
      metadata: { userId: user.id },
    },
  });

  if (!session.url) {
    return NextResponse.json(
      { error: 'Stripe did not return a checkout URL' },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: session.url });
}
