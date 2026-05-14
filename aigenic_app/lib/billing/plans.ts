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
  /**
   * Manual rescrape quota — counted per user across all their sites.
   * `period` defines the rolling window the `count` applies to.
   */
  manualCrawls: { count: number; period: 'day' | 'week' };
  /**
   * Whether a Trigger.dev-driven auto-crawl runs for this plan's sites.
   * `null` = no scheduled crawl, `'daily'` = runs once a day.
   */
  scheduledCrawl: 'daily' | null;
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
  /** CTA label shown on the public landing page pricing card. */
  landingCtaLabel: string;
  /** Visually emphasized as "Most popular" on landing + dashboard. */
  highlighted: boolean;
  /**
   * When true, the plan is hidden from the landing & dashboard pricing UIs
   * and Stripe checkout refuses to start a session for it. Use this to
   * temporarily disable paid plans without deleting their config.
   */
  comingSoon?: boolean;
}

export interface BillingMarketingCopy {
  heading: string;
  subheading: string;
}

export const BILLING_MARKETING: BillingMarketingCopy = {
  heading: 'Pricing that scales with you, not against you.',
  subheading: "Start free. Upgrade when your visitors won't stop talking.",
};

/** Stable ordered list of plans for rendering pricing tables. */
export const PLAN_ORDER: readonly PlanId[] = ['free', 'starter', 'pro'];

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
      'Initial knowledge base crawl',
      '1 manual re-crawl / week',
      'Email escalation',
      'Community support',
    ],
    limits: {
      sites: 1,
      conversationsPerMonth: 30,
      enforceConversationLimit: true,
      manualCrawls: { count: 1, period: 'week' },
      scheduledCrawl: null,
    },
    landingCtaLabel: 'Start free',
    highlighted: false,
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
      'Daily auto-scheduled re-crawl',
      '1 manual re-crawl / day',
      'Custom widget colors & copy',
      'Email support',
    ],
    limits: {
      sites: 2,
      conversationsPerMonth: 300,
      enforceConversationLimit: false,
      overageCentsPerConversation: 15,
      manualCrawls: { count: 1, period: 'day' },
      scheduledCrawl: 'daily',
    },
    landingCtaLabel: 'Start with Starter',
    highlighted: false,
    comingSoon: true,
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
      'Daily auto-scheduled re-crawl',
      '5 manual re-crawls / day',
      'Priority knowledge base re-syncs',
      'Analytics & escalation rules',
      'Email support',
    ],
    limits: {
      sites: 5,
      conversationsPerMonth: 1000,
      enforceConversationLimit: false,
      overageCentsPerConversation: 10,
      manualCrawls: { count: 5, period: 'day' },
      scheduledCrawl: 'daily',
    },
    landingCtaLabel: 'Start with Pro',
    highlighted: true,
    comingSoon: true,
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

/**
 * Start of the rolling window for a plan's manual-crawl quota.
 * `day` = 24 hours ago, `week` = 7 days ago. Use this as the lower bound when
 * counting `crawl_runs` rows for rate-limiting.
 */
export function manualCrawlWindowStart(plan: Plan, now: Date = new Date()): Date {
  const ms = plan.limits.manualCrawls.period === 'week'
    ? 7 * 24 * 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms);
}
