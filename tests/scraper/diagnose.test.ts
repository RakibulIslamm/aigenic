import { describe, expect, it } from 'vitest';
import {
  classifyAccess,
  classifyProbe,
  detectProtection,
  isChallenge,
} from '../../vps-scraper/src/diagnose.js';

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
    expect(classifyAccess({ status, challenged: false, provider: null })).toEqual({
      ok: true,
      status,
      provider: null,
    });
  });

  it.each([401, 403, 429])('HTTP %i → blocked', (status) => {
    expect(classifyAccess({ status, challenged: false, provider: null })).toMatchObject({
      ok: false,
      code: 'blocked',
      status,
    });
  });

  it.each([200, 403, 503])(
    'a Cloudflare challenge (cf-mitigated) is blocked even as HTTP %i',
    (status) => {
      expect(
        classifyAccess({ status, challenged: true, provider: 'Cloudflare' }),
      ).toMatchObject({
        ok: false,
        code: 'blocked',
        detail: 'Cloudflare bot challenge',
      });
    },
  );

  it('a server error → unreachable', () => {
    expect(
      classifyAccess({ status: 502, challenged: false, provider: null }),
    ).toMatchObject({
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
      provider: null,
    });
  });

  it('a 404 is neither a pass nor a block', () => {
    expect(
      classifyAccess({ status: 404, challenged: false, provider: null }),
    ).toMatchObject({
      ok: false,
      code: 'other',
    });
  });
});

/**
 * The blocked-crawl message names the service that blocked us, so an owner
 * whose site isn't on Cloudflare isn't sent looking for a Cloudflare menu.
 */
describe('detectProtection', () => {
  it.each([
    [{ 'cf-ray': '8a1b2c3d4e5f-AMS', server: 'cloudflare' }, 'Cloudflare'],
    [{ server: 'cloudflare' }, 'Cloudflare'],
    [{ 'x-vercel-id': 'fra1::abc', server: 'Vercel' }, 'Vercel Firewall'],
    [{ 'x-vercel-mitigated': 'challenge' }, 'Vercel Firewall'],
    [{ 'x-sucuri-id': '18011' }, 'Sucuri'],
    [{ 'x-iinfo': '1-2-3' }, 'Imperva'],
    [{ server: 'AkamaiGHost' }, 'Akamai'],
    [{ 'x-amz-cf-id': 'abc==' }, 'AWS CloudFront / AWS WAF'],
    [{ server: 'nginx' }, null],
    [{}, null],
  ])('%j → %s', (headers, expected) => {
    expect(detectProtection(new Headers(headers))).toBe(expected);
  });
});

describe('isChallenge', () => {
  it.each([
    [{ 'cf-mitigated': 'challenge' }, true],
    [{ 'x-vercel-mitigated': 'challenge' }, true],
    [{ 'x-vercel-mitigated': 'deny' }, true],
    [{ 'cf-ray': 'x' }, false],
  ])('%j → %s', (headers, expected) => {
    expect(isChallenge(new Headers(headers))).toBe(expected);
  });
});

describe('classifyProbe — naming the blocker', () => {
  it('names the detected service', () => {
    const d = classifyProbe({ status: 403, provider: 'Vercel Firewall' });
    expect(d.code).toBe('blocked');
    expect(d.message).toMatch(/^Vercel Firewall answered with HTTP 403/);
    expect(d.message).not.toMatch(/Cloudflare/);
  });

  it("doesn't guess Cloudflare when it can't tell", () => {
    expect(classifyProbe({ status: 403, provider: null }).message).not.toMatch(
      /Cloudflare/,
    );
  });

  it('a bot challenge names the service in the access check', () => {
    expect(
      classifyAccess({ status: 429, challenged: true, provider: 'Vercel Firewall' }),
    ).toMatchObject({ code: 'blocked', detail: 'Vercel Firewall bot challenge' });
    expect(
      classifyAccess({ status: 403, challenged: false, provider: null }),
    ).toMatchObject({
      detail: 'HTTP 403',
    });
  });
});

describe('classifyAccess — provider', () => {
  it('reports the service on a pass too, so the dashboard can name it', () => {
    expect(
      classifyAccess({ status: 200, challenged: false, provider: 'Cloudflare' }),
    ).toEqual({
      ok: true,
      status: 200,
      provider: 'Cloudflare',
    });
  });

  it('reports it on a block as a field, not only inside the text', () => {
    expect(
      classifyAccess({ status: 403, challenged: true, provider: 'Cloudflare' }),
    ).toMatchObject({ ok: false, code: 'blocked', provider: 'Cloudflare' });
  });
});
