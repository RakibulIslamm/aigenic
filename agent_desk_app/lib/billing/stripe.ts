import Stripe from 'stripe';

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
    appInfo: { name: 'AgentDesk', version: '0.1.0' },
  });
  return cachedClient;
}

export const STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? '';
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && STRIPE_PRO_PRICE_ID);
}
