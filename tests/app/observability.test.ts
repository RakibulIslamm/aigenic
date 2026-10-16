import { afterEach, describe, expect, it, vi } from 'vitest';
import { log, setErrorReporter } from '@/lib/log';
import { redactText, scrubBreadcrumb, scrubEvent } from '@/lib/observability/scrub';
import { buildHealthReport, probeDatabase } from '@/lib/observability/health';

/**
 * Task T0.1: error tracking must never carry personal data (FR-PRIV-6), the
 * log seam must forward errors to whichever reporter the runtime set up, and
 * the health check must tell a monitor the truth about the database.
 */

describe('redactText', () => {
  it('masks email addresses', () => {
    expect(redactText('reply to mario.rossi+test@example.co.uk now')).toBe(
      'reply to [email] now',
    );
  });

  it('masks international and grouped phone numbers', () => {
    expect(redactText('call +39 333 123 4567')).toBe('call [phone]');
    expect(redactText('call 555-123-4567')).toBe('call [phone]');
  });

  it('keeps IDs and timestamps, which are not phone numbers', () => {
    const text = 'site 3f2a9c1e failed at 1792078842601 (attempt 3)';
    expect(redactText(text)).toBe(text);
  });
});

describe('scrubEvent', () => {
  it('drops request bodies, cookies, query strings, the user and most headers', () => {
    const event = scrubEvent({
      request: {
        url: 'https://aigenic.app/api/widget/chat?visitor=abc',
        data: { message: 'my email is a@b.co' },
        cookies: { session: 'secret' },
        query_string: 'visitor=abc',
        headers: {
          'User-Agent': 'Chrome',
          Cookie: 'session=secret',
          'X-Forwarded-For': '1.2.3.4',
        },
      },
      user: { ip_address: '1.2.3.4', email: 'a@b.co' },
    });
    expect(event.request).toEqual({
      url: 'https://aigenic.app/api/widget/chat',
      headers: { 'User-Agent': 'Chrome' },
    });
    expect(event.user).toBeUndefined();
  });

  it('redacts messages, exception values, extras, tags and breadcrumbs', () => {
    const event = scrubEvent({
      message: 'failed for a@b.co',
      exception: { values: [{ value: 'cannot email x@y.io' }] },
      extra: { nested: { list: ['call +44 20 7946 0958'] } },
      tags: { who: 'z@z.org' },
      breadcrumbs: [{ message: 'sent to q@q.com', data: { to: 'q@q.com' } }],
    });
    expect(event.message).toBe('failed for [email]');
    expect(event.exception?.values?.[0]?.value).toBe('cannot email [email]');
    expect(event.extra).toEqual({ nested: { list: ['call [phone]'] } });
    expect(event.tags).toEqual({ who: '[email]' });
    expect(event.breadcrumbs).toEqual([
      { message: 'sent to [email]', data: { to: '[email]' } },
    ]);
  });

  it('returns the same object it was given', () => {
    const input = { message: 'ok' };
    expect(scrubEvent(input)).toBe(input);
    const crumb = { message: 'ok' };
    expect(scrubBreadcrumb(crumb)).toBe(crumb);
  });
});

describe('log.error reporter', () => {
  afterEach(() => {
    setErrorReporter(null);
    vi.restoreAllMocks();
  });

  it('forwards errors to the registered reporter', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reporter = vi.fn();
    setErrorReporter(reporter);
    log.error('crawl failed', { siteId: 's1' });
    expect(reporter).toHaveBeenCalledWith('crawl failed', { siteId: 's1' });
  });

  it('does not forward warnings or opted-out errors', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reporter = vi.fn();
    setErrorReporter(reporter);
    log.warn('slow');
    log.error('already captured', {}, { report: false });
    expect(reporter).not.toHaveBeenCalled();
  });

  it('survives a reporter that throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setErrorReporter(() => {
      throw new Error('reporter down');
    });
    expect(() => log.error('still logs')).not.toThrow();
  });
});

describe('health check', () => {
  it('reports ok when the database answers', async () => {
    expect(await probeDatabase(async () => 1)).toBe('ok');
  });

  it('reports error when the database throws', async () => {
    expect(
      await probeDatabase(async () => {
        throw new Error('connection refused');
      }),
    ).toBe('error');
  });

  it('reports timeout when the database hangs', async () => {
    expect(await probeDatabase(() => new Promise(() => {}), 10)).toBe('timeout');
  });

  it('builds the report from the deploy environment', () => {
    const at = new Date('2026-10-16T10:00:00Z');
    expect(
      buildHealthReport(
        'ok',
        { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: 'abcdef1234567' },
        at,
      ),
    ).toEqual({
      status: 'ok',
      database: 'ok',
      environment: 'preview',
      release: 'abcdef1',
      checkedAt: '2026-10-16T10:00:00.000Z',
    });
    expect(buildHealthReport('timeout', { NODE_ENV: 'development' }, at)).toMatchObject({
      status: 'degraded',
      environment: 'development',
      release: null,
    });
  });
});
