export type PlanId = 'free' | 'starter' | 'pro';

export interface PlanLimits {
  sites: number;
  conversationsPerMonth: number;
  /**
   * When true, new conversations are refused once the monthly count exceeds
   * `conversationsPerMonth`. When false, conversations keep flowing and the
   * overage is metered (see `overageCentsPerConversation`).
   */
  enforceConversationLimit: boolean;
  /**
   * Per-conversation charge applied beyond `conversationsPerMonth`. Only
   * meaningful when `enforceConversationLimit` is false. Stored in cents to
   * avoid floating-point money math.
   */
  overageCentsPerConversation?: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  priceLabel: string;
  /** Sub-label rendered next to the price (e.g. "per month", "forever"). */
  pricePeriod: string;
  description: string;
  features: string[];
  limits: PlanLimits;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    priceLabel: '$0',
    pricePeriod: 'forever',
    description: 'For solo founders and small businesses getting started.',
    features: [
      '1 site',
      '30 conversations / month',
      'Knowledge base auto-crawl',
      'Email escalation',
      'Community support',
    ],
    limits: {
      sites: 1,
      conversationsPerMonth: 30,
      enforceConversationLimit: true,
    },
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    priceLabel: '$19',
    pricePeriod: 'per month',
    description: 'For small sites that outgrew the free tier.',
    features: [
      '2 sites',
      '300 conversations / month',
      'Then $0.15 per additional conversation',
      'Custom widget colors & copy',
      'Email support',
    ],
    limits: {
      sites: 2,
      conversationsPerMonth: 300,
      enforceConversationLimit: false,
      overageCentsPerConversation: 15,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceLabel: '$49',
    pricePeriod: 'per month',
    description: 'For growing teams that live in the dashboard.',
    features: [
      '5 sites',
      '1,000 conversations / month',
      'Then $0.10 per additional conversation',
      'Priority knowledge base re-syncs',
      'Analytics & escalation rules',
      'Email support',
    ],
    limits: {
      sites: 5,
      conversationsPerMonth: 1000,
      enforceConversationLimit: false,
      overageCentsPerConversation: 10,
    },
  },
};

export function getPlan(plan: string | null | undefined): Plan {
  if (plan === 'pro') return PLANS.pro;
  if (plan === 'starter') return PLANS.starter;
  return PLANS.free;
}

export function isPlanId(value: string): value is PlanId {
  return value === 'free' || value === 'starter' || value === 'pro';
}
