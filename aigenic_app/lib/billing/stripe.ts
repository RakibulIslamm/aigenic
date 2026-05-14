import Stripe from 'stripe';
import { PLANS, type PlanId } from './plans';

let cachedClient: Stripe | null = null;

/**
 * Lazily-built Stripe client. Returns null when STRIPE_SECRET_KEY is unset so
 * the rest of the app keeps booting in dev environments without billing wired up.
 */
export function getStripeClient(): Stripe | null {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) return null;
  cachedClient = new Stripe(apiKey, {
    appInfo: { name: 'Aigenic', version: '0.1.0' },
  });
  return cachedClient;
}

export const STRIPE_STARTER_PRICE_ID = process.env.STRIPE_STARTER_PRICE_ID ?? '';
export const STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? '';
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

/** Returns the configured Stripe price id for a paid plan, or '' if none. */
export function priceIdForPlan(plan: PlanId): string {
  if (plan === 'pro') return STRIPE_PRO_PRICE_ID;
  if (plan === 'starter') return STRIPE_STARTER_PRICE_ID;
  return '';
}

/** Reverse lookup: which plan does this Stripe price id correspond to? */
export function planForPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  if (priceId === STRIPE_PRO_PRICE_ID) return 'pro';
  if (priceId === STRIPE_STARTER_PRICE_ID) return 'starter';
  return null;
}

/** True when at least one paid plan has a Stripe price configured. */
export function isStripeConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY && (STRIPE_PRO_PRICE_ID || STRIPE_STARTER_PRICE_ID)
  );
}

/** True when this specific paid plan can be purchased on this deployment. */
export function isPlanPurchasable(plan: PlanId): boolean {
  if (PLANS[plan]?.comingSoon) return false;
  if (!process.env.STRIPE_SECRET_KEY) return false;
  return Boolean(priceIdForPlan(plan));
}
