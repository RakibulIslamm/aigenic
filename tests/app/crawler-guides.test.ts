import { describe, expect, it } from 'vitest';
import { guideForProvider, initialGuideFor } from '@/lib/sites/crawler-identity';

/**
 * Which setup guide the Crawler access card opens. Opening the wrong one sends
 * an owner hunting for menus their firewall doesn't have — the exact confusion
 * ("there is no WAF") this card exists to remove.
 */
describe('guideForProvider', () => {
  it.each([
    ['Cloudflare', 'cloudflare'],
    ['Vercel Firewall', 'vercel'],
    ['Sucuri', 'other'],
    ['AWS CloudFront / AWS WAF', 'other'],
    [null, 'other'],
    [undefined, 'other'],
  ] as const)('%s → %s', (provider, guide) => {
    expect(guideForProvider(provider)).toBe(guide);
  });
});

describe('initialGuideFor', () => {
  it.each([
    [
      'Cloudflare answered with HTTP 403 instead of the page — its bot protection is blocking our crawler.',
      'cloudflare',
    ],
    ['Vercel Firewall answered with HTTP 429 instead of the page', 'vercel'],
    ['Sucuri answered with HTTP 403 instead of the page', 'other'],
    // Unknown blocker, or no error yet: Cloudflare is the common case.
    ['The site answered with HTTP 403 instead of the page — a firewall…', 'cloudflare'],
    [null, 'cloudflare'],
  ] as const)('%j → %s', (error, guide) => {
    expect(initialGuideFor(error)).toBe(guide);
  });
});
