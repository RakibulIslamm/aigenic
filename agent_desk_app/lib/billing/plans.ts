export type PlanId = 'free' | 'pro';

export interface PlanLimits {
  sites: number;
  conversationsPerMonth: number; // Number.POSITIVE_INFINITY for unlimited
}

export interface Plan {
  id: PlanId;
  name: string;
  priceLabel: string;
  description: string;
  features: string[];
  limits: PlanLimits;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    priceLabel: '$0',
    description: 'For solo builders shipping their first SaaS.',
    features: [
      '1 site',
      '100 conversations / month',
      'Knowledge base auto-crawl',
      'Email escalation',
    ],
    limits: { sites: 1, conversationsPerMonth: 100 },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceLabel: '$49',
    description: 'For growing teams that live in the dashboard.',
    features: [
      '5 sites',
      'Unlimited conversations',
      'Priority knowledge base re-syncs',
      'Custom widget colors & copy',
      'Analytics & escalation rules',
      'Email support',
    ],
    limits: { sites: 5, conversationsPerMonth: Number.POSITIVE_INFINITY },
  },
};

export function getPlan(plan: string | null | undefined): Plan {
  return plan === 'pro' ? PLANS.pro : PLANS.free;
}

export function isPlanId(value: string): value is PlanId {
  return value === 'free' || value === 'pro';
}
