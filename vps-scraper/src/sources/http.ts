import type { Response as UndiciResponse } from 'undici';
import { logger } from '../logger.js';
import type { OriginRoute } from '../origin-route.js';
import { isSsrfBlocked, safeFetch } from '../ssrf-guard.js';

/**
 * One bounded JSON GET, shared by every source adapter.
 *
 * Goes through `safeFetch` like the rest of the crawler, so a platform
 * endpoint that redirects somewhere private is refused on every hop rather
 * than only at the first. Returns null for anything that isn't usable JSON —
 * adapters treat "no data" and "not this platform" identically, which is what
 * makes probing cheap: an unrelated site's 404 is just a null.
 */

const TIMEOUT_MS = 15_000;
/** A catalogue page of 100 products runs ~1–2 MB; 12 leaves generous headroom. */
const MAX_BYTES = 12_000_000;

export interface JsonResult<T> {
  data: T;
  /**
   * Response-header accessor. A plain function rather than the `Headers`
   * object because undici's `Headers` and the DOM's are structurally
   * incompatible under this tsconfig — callers only ever want one value by
   * name, so handing back a lookup keeps that mismatch inside this file.
   */
  header: (name: string) => string | null;
}

export async function fetchJson<T>(opts: {
  url: string;
  userAgent: string;
  route: OriginRoute;
  signal: AbortSignal | undefined;
}): Promise<JsonResult<T> | null> {
  const { url, userAgent, route, signal } = opts;
  if (signal?.aborted) return null;

  try {
    const { response } = await safeFetch(url, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'application/json, */*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      route,
      signal: combine(AbortSignal.timeout(TIMEOUT_MS), signal),
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('json')) {
      // A themed 404 page answering 200 with HTML is the common shape of "this
      // platform isn't here" — reading it as JSON would only throw.
      await response.body?.cancel().catch(() => undefined);
      return null;
    }

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      logger.debug({ url, declared }, 'structured source response too large');
      return null;
    }

    const text = await readCapped(response, MAX_BYTES);
    if (text === null) return null;

    return {
      data: JSON.parse(text) as T,
      header: (name) => response.headers.get(name),
    };
  } catch (err) {
    if (isSsrfBlocked(err)) {
      logger.warn({ url }, 'ssrf-guard: blocked structured source fetch');
      return null;
    }
    logger.debug(
      { url, reason: err instanceof Error ? err.message.split('\n')[0] : 'unknown' },
      'structured source fetch failed',
    );
    return null;
  }
}

/** Reads at most `maxBytes`; null when the body runs past the cap. */
async function readCapped(
  response: { body: UndiciResponse['body'] },
  maxBytes: number,
): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let received = 0;
  let out = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        void reader.cancel();
        return null;
      }
      out += decoder.decode(value, { stream: true });
    }
    return out + decoder.decode();
  } catch {
    return null;
  }
}

function combine(a: AbortSignal, b: AbortSignal | undefined): AbortSignal {
  if (!b) return a;
  if (typeof (AbortSignal as { any?: unknown }).any === 'function') {
    return (AbortSignal as { any: (s: AbortSignal[]) => AbortSignal }).any([a, b]);
  }
  const controller = new AbortController();
  for (const s of [a, b]) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}
