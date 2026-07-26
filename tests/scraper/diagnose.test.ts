import { describe, expect, it } from 'vitest';
import { classifyProbe } from '../../vps-scraper/src/diagnose.js';

/**
 * The zero-page-crawl diagnosis. The mapping matters because the dashboard
 * branches on `code`: 'blocked' asks the owner to allow the crawler through
 * their firewall; the others don't. Misclassifying a 403 as 'empty' would
 * hide the one instruction that actually fixes the crawl.
 */
describe('classifyProbe', () => {
  it.each([401, 403, 429])('HTTP %i → blocked (firewall / bot protection)', (status) => {
    const d = classifyProbe({ status });
    expect(d.code).toBe('blocked');
    expect(d.message).toContain(`HTTP ${status}`);
    expect(d.message).toMatch(/allow this app to crawl/i);
  });

  it.each([500, 502, 503])('HTTP %i → unreachable (server error)', (status) => {
    expect(classifyProbe({ status }).code).toBe('unreachable');
  });

  it('a network-level failure → unreachable, naming the reason', () => {
    const d = classifyProbe({ failed: 'getaddrinfo ENOTFOUND example.invalid' });
    expect(d.code).toBe('unreachable');
    expect(d.message).toContain('ENOTFOUND');
  });

  it('a reachable site with nothing extractable → empty', () => {
    // 200 but the crawl still found nothing: JS-only pages or robots rules.
    expect(classifyProbe({ status: 200 }).code).toBe('empty');
  });

  it('redirect-ish and client-error statuses that are not blocks → empty', () => {
    // e.g. the probe hit a 404 landing page — not a firewall verdict.
    expect(classifyProbe({ status: 404 }).code).toBe('empty');
  });
});
