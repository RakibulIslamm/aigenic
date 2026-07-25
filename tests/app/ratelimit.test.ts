import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The shared Postgres fixed-window limiter. The SQL itself runs in the
 * database; what this exercises is the module's contract: how a returned
 * row maps to ok/remaining/retryAfter, that a store failure FAILS OPEN
 * (blocking every tenant's widget because the limiter table hiccuped would
 * be a self-inflicted outage), and the IP extraction the keys depend on.
 */

const execute = vi.fn<(q: unknown) => Promise<unknown>>();
const logError = vi.fn();
const logWarn = vi.fn();

vi.mock('@/db', () => ({ db: { execute: (q: unknown) => execute(q) } }));
vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: logWarn, error: logError },
}));

const { MAX_WINDOW_SECONDS, clientIp, consumeRateLimit } =
  await import('@/lib/ratelimit');

beforeEach(() => {
  vi.clearAllMocks();
  // Pin the opportunistic stale-row sweep OFF so call counts are exact.
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('consumeRateLimit', () => {
  it('allows under the limit and reports what is left', async () => {
    execute.mockResolvedValueOnce([{ count: 3, retry_after: 7 }]);
    const res = await consumeRateLimit({ key: 'k', limit: 5, windowSeconds: 10 });
    expect(res).toEqual({ ok: true, remaining: 2, retryAfterSeconds: 7 });
  });

  it('blocks over the limit with the window-end Retry-After', async () => {
    execute.mockResolvedValueOnce([{ count: 6, retry_after: 4 }]);
    const res = await consumeRateLimit({ key: 'k', limit: 5, windowSeconds: 10 });
    expect(res).toEqual({ ok: false, remaining: 0, retryAfterSeconds: 4 });
  });

  it('treats exactly-at-limit as allowed and one-past as blocked', async () => {
    execute.mockResolvedValueOnce([{ count: 5, retry_after: 9 }]);
    expect((await consumeRateLimit({ key: 'k', limit: 5, windowSeconds: 10 })).ok).toBe(
      true,
    );

    execute.mockResolvedValueOnce([{ count: 6, retry_after: 9 }]);
    expect((await consumeRateLimit({ key: 'k', limit: 5, windowSeconds: 10 })).ok).toBe(
      false,
    );
  });

  it('fails OPEN when the store is unreachable, and says so in the log', async () => {
    execute.mockRejectedValueOnce(new Error('connection refused'));
    const res = await consumeRateLimit({ key: 'k', limit: 5, windowSeconds: 10 });
    expect(res.ok).toBe(true);
    expect(res.remaining).toBe(5);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('fails OPEN on an empty result set too', async () => {
    execute.mockResolvedValueOnce([]);
    const res = await consumeRateLimit({ key: 'k', limit: 5, windowSeconds: 10 });
    expect(res.ok).toBe(true);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('refuses a window longer than the sweep can tolerate', async () => {
    // A window past MAX_WINDOW_SECONDS would have its row deleted mid-window
    // by the stale sweep — a config bug, so it throws instead of mislimiting.
    await expect(
      consumeRateLimit({ key: 'k', limit: 5, windowSeconds: MAX_WINDOW_SECONDS + 1 }),
    ).rejects.toThrow(/MAX_WINDOW_SECONDS/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('sweeps stale rows occasionally, without failing the request', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    execute.mockResolvedValueOnce([{ count: 1, retry_after: 10 }]);
    execute.mockRejectedValueOnce(new Error('sweep failed'));

    const res = await consumeRateLimit({ key: 'k', limit: 5, windowSeconds: 10 });
    expect(res.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);

    // The sweep is fire-and-forget; give its rejection a tick to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(logWarn).toHaveBeenCalledTimes(1);
  });
});

describe('clientIp', () => {
  const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

  it('takes the first x-forwarded-for entry (the client, on Vercel)', () => {
    expect(clientIp(req({ 'x-forwarded-for': ' 1.2.3.4 , 10.0.0.1' }))).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip', () => {
    expect(clientIp(req({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });

  it('shares the unknown bucket when no proxy header exists (local dev)', () => {
    expect(clientIp(req({}))).toBe('unknown');
  });
});
