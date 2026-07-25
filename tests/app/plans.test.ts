import { describe, expect, it } from 'vitest';
import {
  PLAN_ORDER,
  PLANS,
  getPlan,
  isPlanId,
  manualCrawlWindowStart,
  type PlanId,
} from '@/lib/billing/plans';

/**
 * Plan limits are load-bearing: the chat endpoint refuses conversations off
 * `enforceConversationLimit` + `conversationsPerMonth`, and the rescrape quota
 * reads `manualCrawls`. This table pins every number so a pricing edit can't
 * silently change enforcement.
 */
const EXPECTED = {
  free: {
    sites: 1,
    conversationsPerMonth: 30,
    enforceConversationLimit: true,
    overageCentsPerConversation: undefined,
    manualCrawls: { count: 1, period: 'week' },
    scheduledCrawl: null,
    comingSoon: undefined,
  },
  starter: {
    sites: 2,
    conversationsPerMonth: 300,
    enforceConversationLimit: false,
    overageCentsPerConversation: 15,
    manualCrawls: { count: 1, period: 'day' },
    scheduledCrawl: 'daily',
    comingSoon: true,
  },
  pro: {
    sites: 5,
    conversationsPerMonth: 1000,
    enforceConversationLimit: false,
    overageCentsPerConversation: 10,
    manualCrawls: { count: 5, period: 'day' },
    scheduledCrawl: 'daily',
    comingSoon: true,
  },
} as const;

describe('PLANS', () => {
  it.each(Object.keys(EXPECTED) as PlanId[])('pins %s limits', (id) => {
    const plan = PLANS[id];
    const want = EXPECTED[id];

    expect(plan.id).toBe(id);
    expect(plan.limits.sites).toBe(want.sites);
    expect(plan.limits.conversationsPerMonth).toBe(want.conversationsPerMonth);
    expect(plan.limits.enforceConversationLimit).toBe(want.enforceConversationLimit);
    expect(plan.limits.overageCentsPerConversation).toBe(
      want.overageCentsPerConversation,
    );
    expect(plan.limits.manualCrawls).toEqual(want.manualCrawls);
    expect(plan.limits.scheduledCrawl).toBe(want.scheduledCrawl);
    expect(plan.comingSoon).toBe(want.comingSoon);
  });

  it('only hard-caps conversations on the free plan', () => {
    expect(PLANS.free.limits.enforceConversationLimit).toBe(true);
    expect(PLANS.starter.limits.enforceConversationLimit).toBe(false);
    expect(PLANS.pro.limits.enforceConversationLimit).toBe(false);
  });

  it('gives every metered plan an overage price', () => {
    for (const plan of Object.values(PLANS)) {
      if (!plan.limits.enforceConversationLimit) {
        expect(typeof plan.limits.overageCentsPerConversation).toBe('number');
      }
    }
  });

  it('orders plans cheapest-first and covers every plan exactly once', () => {
    expect(PLAN_ORDER).toEqual(['free', 'starter', 'pro']);
    expect([...PLAN_ORDER].sort()).toEqual(Object.keys(PLANS).sort());
  });
});

describe('getPlan', () => {
  it('resolves the known plan ids', () => {
    expect(getPlan('free').id).toBe('free');
    expect(getPlan('starter').id).toBe('starter');
    expect(getPlan('pro').id).toBe('pro');
  });

  it('falls back to free for unknown, null or undefined input', () => {
    expect(getPlan(null).id).toBe('free');
    expect(getPlan(undefined).id).toBe('free');
    expect(getPlan('').id).toBe('free');
    expect(getPlan('enterprise').id).toBe('free');
    expect(getPlan('PRO').id).toBe('free');
  });
});

describe('isPlanId', () => {
  it('accepts exactly the three plan ids', () => {
    expect(isPlanId('free')).toBe(true);
    expect(isPlanId('starter')).toBe(true);
    expect(isPlanId('pro')).toBe(true);
  });

  it('rejects anything else, including case variants', () => {
    expect(isPlanId('Pro')).toBe(false);
    expect(isPlanId('enterprise')).toBe(false);
    expect(isPlanId('')).toBe(false);
  });
});

describe('manualCrawlWindowStart', () => {
  const now = new Date('2026-07-25T12:00:00.000Z');

  it('looks back 7 days for a weekly quota (free)', () => {
    expect(manualCrawlWindowStart(PLANS.free, now).toISOString()).toBe(
      '2026-07-18T12:00:00.000Z',
    );
  });

  it('looks back 24 hours for a daily quota (starter, pro)', () => {
    expect(manualCrawlWindowStart(PLANS.starter, now).toISOString()).toBe(
      '2026-07-24T12:00:00.000Z',
    );
    expect(manualCrawlWindowStart(PLANS.pro, now).toISOString()).toBe(
      '2026-07-24T12:00:00.000Z',
    );
  });

  it('always returns a past instant', () => {
    for (const plan of Object.values(PLANS)) {
      expect(manualCrawlWindowStart(plan, now).getTime()).toBeLessThan(now.getTime());
    }
  });
});
