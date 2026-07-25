import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '@/db';
import { users } from '@/db/schema';
import { isPlanId, type PlanId } from './plans';
import { getStripeClient, planForPriceId } from './stripe';

/**
 * Fallback path for when the Stripe webhook hasn't (or can't) fire by the
 * time the user is redirected back from Checkout. Retrieves the session from
 * Stripe, verifies it belongs to this user, and flips `users.plan` directly.
 *
 * Returns the plan the user is now on, or null when the session can't be
 * resolved / doesn't match the user / payment hasn't completed yet.
 */
export async function syncUserFromCheckoutSession(
  sessionId: string,
  userId: string,
): Promise<PlanId | null> {
  const stripe = getStripeClient();
  if (!stripe) return null;

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });
  } catch {
    return null;
  }

  if (session.metadata?.userId !== userId) return null;
  if (
    session.payment_status !== 'paid' &&
    session.payment_status !== 'no_payment_required'
  ) {
    return null;
  }

  const subscription =
    typeof session.subscription === 'object' && session.subscription !== null
      ? (session.subscription as Stripe.Subscription)
      : null;
  const priceId = subscription?.items.data[0]?.price?.id;
  const planFromPrice = planForPriceId(priceId);
  const planFromMeta =
    session.metadata?.plan &&
    isPlanId(session.metadata.plan) &&
    session.metadata.plan !== 'free'
      ? (session.metadata.plan as PlanId)
      : null;
  const targetPlan: PlanId = planFromPrice ?? planFromMeta ?? 'pro';

  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : (session.customer?.id ?? null);
  const subscriptionId = subscription?.id ?? null;

  await db
    .update(users)
    .set({
      plan: targetPlan,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
    })
    .where(eq(users.id, userId));

  return targetPlan;
}
