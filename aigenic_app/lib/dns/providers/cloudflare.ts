import 'server-only';
import { z } from 'zod';
import { DNS_PROVIDER_META } from '@/lib/dns/catalog';
import { DnsProviderError, codeForStatus } from '@/lib/dns/errors';
import {
  normalizeName,
  parseJson,
  providerFetch,
  type ProviderResponse,
} from '@/lib/dns/http';
import type {
  DnsCredentials,
  DnsProvider,
  DnsRecord,
  DnsZone,
  UpsertRecordInput,
  UpsertRecordResult,
  VerifiedCredentials,
} from '@/lib/dns/types';

/**
 * Cloudflare API v4.
 *
 * Two things about Cloudflare shape this adapter.
 *
 * First, **`success` is not the HTTP status.** Cloudflare answers 200 with
 * `{"success": false, "errors": [...]}` often enough that branching on
 * `response.ok` alone would report a permission failure as a success.
 *
 * Second, **a proxied record still exposes the real origin in `content`.**
 * That is what makes origin auto-detection work on exactly the zones this
 * feature exists for: a site sitting behind the orange cloud is the reason the
 * crawler was getting 403s, and the A record behind it is the address we need.
 *
 * Docs: https://developers.cloudflare.com/api/resources/dns/subresources/records/
 */

const BASE_URL = 'https://api.cloudflare.com/client/v4';
/** Cloudflare caps zone listing at 50 per page; records at 100. */
const ZONE_PAGE_SIZE = 50;
const RECORD_PAGE_SIZE = 100;
const MAX_PAGES = 10;

const credentialsSchema = z.object({
  apiToken: z
    .string()
    .trim()
    .min(20, 'That does not look like a Cloudflare API token.')
    .max(200),
});

const envelopeSchema = z.object({
  success: z.boolean(),
  errors: z
    .array(z.object({ code: z.number().optional(), message: z.string().optional() }))
    .optional(),
  result: z.unknown().optional(),
  result_info: z
    .object({ page: z.number().optional(), total_pages: z.number().optional() })
    .optional(),
});

const zoneSchema = z.object({ id: z.string(), name: z.string() });
const recordSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  type: z.string(),
  content: z.string().optional(),
  ttl: z.number().optional(),
  proxied: z.boolean().optional(),
});

export const cloudflareProvider: DnsProvider = {
  ...DNS_PROVIDER_META.cloudflare,

  parseCredentials(raw) {
    return parseCredentials(raw);
  },

  async verify(credentials) {
    return verify(credentials);
  },

  async listZones(credentials) {
    return listZones(credentials);
  },

  async listRecords(credentials, zone) {
    return listRecords(credentials, zone);
  },

  async upsertRecord(credentials, input) {
    return upsertRecord(credentials, input);
  },
};

function parseCredentials(raw: Record<string, string>): DnsCredentials {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DnsProviderError(
      'invalid_credentials',
      issue?.message ?? 'Enter your Cloudflare API token.',
      'apiToken',
    );
  }
  return { apiToken: parsed.data.apiToken };
}

async function verify(credentials: DnsCredentials): Promise<VerifiedCredentials> {
  // The token-verify endpoint is user-scoped, and an account-owned token is
  // rejected there even when it is perfectly valid. So a failure here is not a
  // verdict: fall through to a real zone read, which is the permission we
  // actually need anyway.
  const response = await request(credentials, `${BASE_URL}/user/tokens/verify`);
  const envelope = envelopeSchema.safeParse(parseJson(response));
  if (envelope.success && envelope.data.success) {
    const status = z
      .object({ status: z.string().optional() })
      .safeParse(envelope.data.result);
    if (status.success && status.data.status && status.data.status !== 'active') {
      throw new DnsProviderError(
        'unauthorized',
        `This Cloudflare token is ${status.data.status}. Create a new one and try again.`,
        'apiToken',
      );
    }
    return { label: 'Cloudflare API token' };
  }

  const zones = await listZones(credentials);
  return {
    label:
      zones.length === 1 && zones[0]
        ? `Cloudflare · ${zones[0].name}`
        : `Cloudflare · ${zones.length} zone${zones.length === 1 ? '' : 's'}`,
  };
}

async function listZones(credentials: DnsCredentials): Promise<DnsZone[]> {
  const zones: DnsZone[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await request(
      credentials,
      `${BASE_URL}/zones?page=${page}&per_page=${ZONE_PAGE_SIZE}&order=name&direction=asc`,
    );
    const envelope = expectSuccess(response, 'list your Cloudflare zones');
    const parsed = z.array(zoneSchema).safeParse(envelope.result);
    if (!parsed.success) break;

    for (const zone of parsed.data) {
      zones.push({ id: zone.id, name: normalizeName(zone.name) });
    }

    const totalPages = envelope.result_info?.total_pages ?? 1;
    if (page >= totalPages) break;
  }
  return zones;
}

async function listRecords(
  credentials: DnsCredentials,
  zone: DnsZone,
): Promise<DnsRecord[]> {
  const records: DnsRecord[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await request(
      credentials,
      `${BASE_URL}/zones/${encodeURIComponent(zone.id)}/dns_records?page=${page}&per_page=${RECORD_PAGE_SIZE}`,
    );
    const envelope = expectSuccess(response, `read the ${zone.name} zone`);
    const parsed = z.array(recordSchema).safeParse(envelope.result);
    if (!parsed.success) break;

    for (const record of parsed.data) {
      records.push({
        id: record.id ?? null,
        name: normalizeName(record.name),
        type: record.type.toUpperCase(),
        value: record.content ?? '',
        ttl: record.ttl ?? null,
        ...(record.proxied === undefined ? {} : { proxied: record.proxied }),
      });
    }

    const totalPages = envelope.result_info?.total_pages ?? 1;
    if (page >= totalPages) break;
  }
  return records;
}

/**
 * Read-then-write rather than POST-and-catch-81057.
 *
 * The error path can only tell us "a record already exists"; it can't fix the
 * case that actually matters — a `crawl` record left over from a previous
 * origin, still pointing at an address that no longer serves the site. Reading
 * first handles both, and makes pressing the button twice a no-op.
 */
async function upsertRecord(
  credentials: DnsCredentials,
  input: UpsertRecordInput,
): Promise<UpsertRecordResult> {
  const { zone, name, type, value, ttl } = input;
  const zonePath = `${BASE_URL}/zones/${encodeURIComponent(zone.id)}/dns_records`;

  const existingResponse = await request(
    credentials,
    `${zonePath}?type=${type}&name.exact=${encodeURIComponent(name)}`,
  );
  const existingEnvelope = expectSuccess(existingResponse, `read the ${zone.name} zone`);
  const existing = z.array(recordSchema).safeParse(existingEnvelope.result);
  const match = existing.success ? existing.data[0] : undefined;

  const body = JSON.stringify({
    type,
    name,
    content: value,
    ttl,
    // The whole point of the record: unproxied, so DNS answers with the origin
    // instead of Cloudflare's edge — which is the thing refusing the crawler.
    proxied: false,
    comment: 'Created by Aigenic so its crawler can reach this origin directly',
  });

  if (match?.id) {
    const response = await request(
      credentials,
      `${zonePath}/${encodeURIComponent(match.id)}`,
      { method: 'PUT', body },
    );
    expectSuccess(response, `update ${name}`);
    return { recordId: match.id, updated: true };
  }

  const response = await request(credentials, zonePath, { method: 'POST', body });
  const envelope = expectSuccess(response, `create ${name}`);
  const created = recordSchema.safeParse(envelope.result);
  return { recordId: created.success ? (created.data.id ?? null) : null, updated: false };
}

async function request(
  credentials: DnsCredentials,
  url: string,
  init: { method?: string; body?: string } = {},
) {
  return providerFetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${credentials.apiToken ?? ''}`,
      'Content-Type': 'application/json',
    },
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}

/** Cloudflare's envelope, or a `DnsProviderError` naming what we were doing. */
function expectSuccess(
  response: ProviderResponse,
  action: string,
): z.infer<typeof envelopeSchema> {
  const envelope = envelopeSchema.safeParse(parseJson(response));
  if (!envelope.success) {
    throw new DnsProviderError(
      'unavailable',
      `Cloudflare returned an unexpected response when we tried to ${action}.`,
    );
  }
  if (envelope.data.success) return envelope.data;

  const errors = envelope.data.errors ?? [];
  const codes = new Set(errors.map((error) => error.code));

  if (codes.has(81053)) {
    throw new DnsProviderError(
      'conflict',
      'A CNAME already exists at that name in Cloudflare. Remove it, then try again — ' +
        'DNS does not allow a CNAME and an A record to share a name.',
    );
  }
  if (response.status === 403 || codes.has(9109) || codes.has(10000)) {
    throw new DnsProviderError(
      'forbidden',
      `Your Cloudflare token isn't allowed to ${action}. It needs Zone → Zone → Read and Zone → DNS → Edit.`,
      'apiToken',
    );
  }
  if (response.status === 401 || codes.has(6003) || codes.has(1000)) {
    throw new DnsProviderError(
      'unauthorized',
      'Cloudflare rejected that API token. Check it was copied in full and has not been revoked.',
      'apiToken',
    );
  }

  const detail = errors.find((error) => error.message)?.message;
  throw new DnsProviderError(
    codeForStatus(response.status),
    `Cloudflare could not ${action}${detail ? `: ${detail}` : '.'}`,
  );
}
