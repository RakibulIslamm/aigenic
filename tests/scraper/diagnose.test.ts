import { describe, expect, it } from 'vitest';
import { classifyAccess, classifyProbe } from '../../vps-scraper/src/diagnose.js';

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
    // 200 but the crawl still found nothing: JS-only pages.
    expect(classifyProbe({ status: 200 }).code).toBe('empty');
  });

  it('redirect-ish and client-error statuses that are not blocks → empty', () => {
    // e.g. the probe hit a 404 landing page — not a firewall verdict.
    expect(classifyProbe({ status: 404 }).code).toBe('empty');
  });
});

/**
 * The dashboard's Test access button. A false "you're through" would send the
 * owner off to re-crawl into the same wall, so a bot check must never read as
 * a pass — whatever status code it arrived with.
 */
describe('classifyAccess', () => {
  it.each([200, 204, 301])('HTTP %i → ok', (status) => {
    expect(classifyAccess({ status, challenged: false })).toEqual({ ok: true, status });
  });

  it.each([401, 403, 429])('HTTP %i → blocked', (status) => {
    expect(classifyAccess({ status, challenged: false })).toMatchObject({
      ok: false,
      code: 'blocked',
      status,
    });
  });

  it.each([200, 403, 503])(
    'a Cloudflare challenge (cf-mitigated) is blocked even as HTTP %i',
    (status) => {
      expect(classifyAccess({ status, challenged: true })).toMatchObject({
        ok: false,
        code: 'blocked',
        detail: 'Cloudflare challenge',
      });
    },
  );

  it('a server error → unreachable', () => {
    expect(classifyAccess({ status: 502, challenged: false })).toMatchObject({
      ok: false,
      code: 'unreachable',
    });
  });

  it('a network failure → unreachable, naming it', () => {
    expect(classifyAccess({ failed: 'getaddrinfo ENOTFOUND x.invalid' })).toEqual({
      ok: false,
      code: 'unreachable',
      status: null,
      detail: 'getaddrinfo ENOTFOUND x.invalid',
    });
  });

  it('a 404 is neither a pass nor a block', () => {
    expect(classifyAccess({ status: 404, challenged: false })).toMatchObject({
      ok: false,
      code: 'other',
    });
  });
});
