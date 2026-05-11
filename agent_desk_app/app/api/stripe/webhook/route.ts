import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '@/db';
import { users } from '@/db/schema';
import {
  getStripeClient,
  STRIPE_WEBHOOK_SECRET,
} from '@/lib/billing/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stripe webhook receiver. Reads the raw body for signature verification
 * (Next.js gives us the raw bytes via request.text() before parsing).
 *
 * Subscription lifecycle:
 *   - checkout.session.completed → first signal a user upgraded
 *   - customer.subscription.updated → status change (paused, past_due, …)
 *   - customer.subscription.deleted → cancelled, drop them back to free
 */
export async function POST(request: NextRequest) {
  const stripe = getStripeClient();
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: 'Stripe webhook is not configured' },
      { status: 503 }
    );
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signature verification failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const customerId =
          typeof session.customer === 'string' ? session.customer : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;

        if (userId) {
          await db
            .update(users)
            .set({
              plan: 'pro',
              stripeCustomerId: customerId ?? null,
              stripeSubscriptionId: subscriptionId ?? null,
            })
            .where(eq(users.id, userId));
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId ?? null;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

        // Active-ish statuses keep them on Pro; anything else demotes.
        const isActive =
          sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due';
        const targetPlan = isActive ? 'pro' : 'free';

        if (userId) {
          await db
            .update(users)
            .set({
              plan: targetPlan,
              stripeCustomerId: customerId,
              stripeSubscriptionId: sub.id,
            })
            .where(eq(users.id, userId));
        } else {
          // Fallback when metadata is missing — match by customer id.
          await db
            .update(users)
            .set({
              plan: targetPlan,
              stripeSubscriptionId: sub.id,
            })
            .where(eq(users.stripeCustomerId, customerId));
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId ?? null;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

        if (userId) {
          await db
            .update(users)
            .set({ plan: 'free', stripeSubscriptionId: null })
            .where(eq(users.id, userId));
        } else {
          await db
            .update(users)
            .set({ plan: 'free', stripeSubscriptionId: null })
            .where(eq(users.stripeCustomerId, customerId));
        }
        break;
      }

      default:
        // Quietly ignore — Stripe sends a lot of events we don't care about.
        break;
    }
  } catch (err) {
    console.error('Stripe webhook handler failed', { eventType: event.type, err });
    // Return 500 so Stripe retries the delivery.
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
