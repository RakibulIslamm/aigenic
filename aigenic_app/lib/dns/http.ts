import 'server-only';
import { DnsProviderError } from '@/lib/dns/errors';

/**
 * The one outbound call every DNS adapter makes.
 *
 * No SSRF guard here, deliberately: unlike the crawler, these requests go to
 * five hard-coded vendor hostnames that no user input can influence. What they
 * *do* need is a timeout (a hung provider would otherwise hold a server action
 * open until the platform kills it) and a body cap (a zone with tens of
 * thousands of records is a real thing).
 */

const REQUEST_TIMEOUT_MS = 15_000;
/** Generous for a page of DNS records; small enough to bound memory. */
const MAX_RESPONSE_BYTES = 8_000_000;

export interface ProviderResponse {
  status: number;
  ok: boolean;
  body: string;
  header: (name: string) => string | null;
}

export async function providerFetch(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  } = {},
): Promise<ProviderResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      ...(init.body === undefined ? {} : { body: init.body }),
      cache: 'no-store',
      redirect: 'follow',
      signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new DnsProviderError(
      'unavailable',
      err instanceof Error && err.name === 'TimeoutError'
        ? 'Your DNS provider took too long to respond. Try again in a moment.'
        : 'Could not reach your DNS provider. Check your connection and try again.',
    );
  }

  const body = await readCapped(response);
  return {
    status: response.status,
    ok: response.ok,
    body,
    header: (name) => response.headers.get(name),
  };
}

/** JSON body or a `DnsProviderError` — never a half-parsed object. */
export function parseJson<T>(response: ProviderResponse): T {
  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new DnsProviderError(
      'unavailable',
      `Your DNS provider returned something we could not read (HTTP ${response.status}).`,
    );
  }
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let received = 0;
  let out = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        void reader.cancel();
        throw new DnsProviderError(
          'unavailable',
          'Your DNS provider sent more data than we can process. If this zone is very large, contact support.',
        );
      }
      out += decoder.decode(value, { stream: true });
    }
    return out + decoder.decode();
  } catch (err) {
    if (err instanceof DnsProviderError) throw err;
    throw new DnsProviderError(
      'unavailable',
      'The response from your DNS provider was cut short. Try again in a moment.',
    );
  }
}

/** `crawl.example.com.` → `crawl.example.com`; also lowercases. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Minimal XML value reader for the two providers that answer in XML.
 *
 * A full parser would be a dependency and an attack surface for what amounts
 * to pulling flat leaf values out of documents whose shape is fixed and
 * documented. The one non-obvious rule: entity decoding has to happen after
 * extraction, or a `&lt;` inside a value would look like a tag boundary.
 */
export function xmlBlocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    if (match[1] !== undefined) out.push(match[1]);
  }
  return out;
}

export function xmlValue(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const match = re.exec(xml);
  return match?.[1] === undefined ? null : decodeXmlEntities(match[1]).trim();
}

/** Value of an attribute on the first occurrence of `tag`. */
export function xmlAttr(xml: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*"([^"]*)"`, 'i');
  const match = re.exec(xml);
  return match?.[1] === undefined ? null : decodeXmlEntities(match[1]);
}

/** All self-closing or open tags of `tag`, returned as attribute maps. */
export function xmlElements(xml: string, tag: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  const re = new RegExp(`<${tag}\\b([^>]*)/?>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const attrs: Record<string, string> = {};
    const attrRe = /([A-Za-z0-9_:.-]+)\s*=\s*"([^"]*)"/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRe.exec(match[1] ?? '')) !== null) {
      if (attrMatch[1] && attrMatch[2] !== undefined) {
        attrs[attrMatch[1].toLowerCase()] = decodeXmlEntities(attrMatch[2]);
      }
    }
    out.push(attrs);
  }
  return out;
}

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
