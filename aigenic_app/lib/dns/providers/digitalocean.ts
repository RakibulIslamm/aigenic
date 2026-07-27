import 'server-only';
import { z } from 'zod';
import { DNS_PROVIDER_META } from '@/lib/dns/catalog';
import { DnsProviderError, codeForStatus } from '@/lib/dns/errors';
import { normalizeName, parseJson, providerFetch } from '@/lib/dns/http';
import { relativeRecordName } from '@/lib/sites/domains';
import type {
  DnsCredentials,
  DnsProvider,
  DnsRecord,
  DnsZone,
  UpsertRecordInput,
  UpsertRecordResult,
} from '@/lib/dns/types';

/**
 * DigitalOcean API v2.
 *
 * The one thing to keep straight is DigitalOcean's name asymmetry: the `name`
 * you *filter* by is fully qualified (`crawl.example.com`), while the `name`
 * in request and response *bodies* is relative to the domain (`crawl`, or `@`
 * for the apex). Sending an FQDN in the body creates
 * `crawl.example.com.example.com`, which resolves to nothing and looks like a
 * propagation delay rather than a bug. Every conversion is funnelled through
 * `relativeRecordName` / `absoluteName` below so there's one place to be
 * right.
 *
 * Docs: https://docs.digitalocean.com/reference/api/reference/domain-records/
 */

const BASE_URL = 'https://api.digitalocean.com/v2';
const PAGE_SIZE = 200;
const MAX_PAGES = 10;

const credentialsSchema = z.object({
  apiToken: z
    .string()
    .trim()
    .min(20, 'That does not look like a DigitalOcean personal access token.')
    .max(300),
});

const accountSchema = z.object({
  account: z.object({
    email: z.string().optional(),
    status: z.string().optional(),
    status_message: z.string().optional(),
  }),
});

const domainsSchema = z.object({
  domains: z
    .array(z.object({ name: z.string() }))
    .nullable()
    .optional(),
  links: z
    .object({ pages: z.object({ next: z.string().optional() }).optional() })
    .optional(),
});

const recordSchema = z.object({
  id: z.number(),
  type: z.string(),
  name: z.string(),
  data: z.string().nullable().optional(),
  ttl: z.number().nullable().optional(),
});

const recordsSchema = z.object({
  domain_records: z.array(recordSchema).nullable().optional(),
  links: z
    .object({ pages: z.object({ next: z.string().optional() }).optional() })
    .optional(),
});

export const digitalOceanProvider: DnsProvider = {
  ...DNS_PROVIDER_META.digitalocean,

  parseCredentials(raw) {
    const parsed = credentialsSchema.safeParse(raw);
    if (!parsed.success) {
      throw new DnsProviderError(
        'invalid_credentials',
        parsed.error.issues[0]?.message ?? 'Enter your DigitalOcean token.',
        'apiToken',
      );
    }
    return { apiToken: parsed.data.apiToken };
  },

  async verify(credentials) {
    const response = await request(credentials, `${BASE_URL}/account`);
    expectOk(response, 'check your DigitalOcean token');
    const parsed = accountSchema.safeParse(parseJson(response));
    if (!parsed.success) {
      throw new DnsProviderError(
        'unavailable',
        'DigitalOcean returned an account response we could not read.',
      );
    }
    const { email, status, status_message: statusMessage } = parsed.data.account;
    if (status && status !== 'active') {
      // A locked account authenticates fine and then fails every write, which
      // would otherwise surface much later as a mysterious record-create error.
      throw new DnsProviderError(
        'forbidden',
        `Your DigitalOcean account is ${status}${statusMessage ? ` — ${statusMessage}` : ''}. Resolve that first, then reconnect.`,
      );
    }
    return { label: email ? `DigitalOcean · ${email}` : 'DigitalOcean' };
  },

  async listZones(credentials) {
    const zones: DnsZone[] = [];
    let url: string | undefined = `${BASE_URL}/domains?per_page=${PAGE_SIZE}`;
    for (let page = 0; page < MAX_PAGES && url; page++) {
      const response = await request(credentials, url);
      expectOk(response, 'list your DigitalOcean domains');
      const parsed = domainsSchema.safeParse(parseJson(response));
      if (!parsed.success) break;
      for (const domain of parsed.data.domains ?? []) {
        const name = normalizeName(domain.name);
        // DigitalOcean identifies a zone by its name, so id and name coincide.
        zones.push({ id: name, name });
      }
      url = parsed.data.links?.pages?.next;
    }
    return zones;
  },

  async listRecords(credentials, zone) {
    const records: DnsRecord[] = [];
    let url: string | undefined =
      `${BASE_URL}/domains/${encodeURIComponent(zone.name)}/records?per_page=${PAGE_SIZE}`;
    for (let page = 0; page < MAX_PAGES && url; page++) {
      const response = await request(credentials, url);
      expectOk(response, `read the ${zone.name} zone`);
      const parsed = recordsSchema.safeParse(parseJson(response));
      if (!parsed.success) break;
      for (const record of parsed.data.domain_records ?? []) {
        records.push({
          id: String(record.id),
          name: absoluteName(record.name, zone.name),
          type: record.type.toUpperCase(),
          value: record.data ?? '',
          ttl: record.ttl ?? null,
        });
      }
      url = parsed.data.links?.pages?.next;
    }
    return records;
  },

  async upsertRecord(credentials, input) {
    return upsertRecord(credentials, input);
  },
};

async function upsertRecord(
  credentials: DnsCredentials,
  input: UpsertRecordInput,
): Promise<UpsertRecordResult> {
  const { zone, name, type, value, ttl } = input;
  const relative = relativeRecordName(name, zone.name);
  if (!relative) {
    throw new DnsProviderError(
      'not_found',
      `${name} is not inside the ${zone.name} zone.`,
    );
  }

  const zonePath = `${BASE_URL}/domains/${encodeURIComponent(zone.name)}/records`;

  // The filter takes the FQDN even though the body takes the relative name.
  const existingResponse = await request(
    credentials,
    `${zonePath}?type=${type}&name=${encodeURIComponent(name)}&per_page=${PAGE_SIZE}`,
  );
  expectOk(existingResponse, `read the ${zone.name} zone`);
  const existing = recordsSchema.safeParse(parseJson(existingResponse));
  const match = existing.success
    ? (existing.data.domain_records ?? []).find(
        (record) => record.type.toUpperCase() === type,
      )
    : undefined;

  const body = JSON.stringify({ type, name: relative, data: value, ttl });

  if (match) {
    const response = await request(credentials, `${zonePath}/${match.id}`, {
      method: 'PUT',
      body,
    });
    expectOk(response, `update ${name}`);
    return { recordId: String(match.id), updated: true };
  }

  const response = await request(credentials, zonePath, { method: 'POST', body });
  expectOk(response, `create ${name}`);
  const created = z
    .object({ domain_record: recordSchema })
    .safeParse(parseJson(response));
  return {
    recordId: created.success ? String(created.data.domain_record.id) : null,
    updated: false,
  };
}

function absoluteName(relative: string, zoneName: string): string {
  const name = relative.trim().toLowerCase().replace(/\.$/, '');
  if (name === '@' || name === '') return zoneName;
  if (name.endsWith(`.${zoneName}`) || name === zoneName) return name;
  return `${name}.${zoneName}`;
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

function expectOk(
  response: { status: number; ok: boolean; body: string },
  action: string,
) {
  if (response.ok) return;

  const parsed = z
    .object({ id: z.string().optional(), message: z.string().optional() })
    .safeParse(safeParseJson(response.body));
  const message = parsed.success ? parsed.data.message : undefined;

  if (response.status === 401) {
    throw new DnsProviderError(
      'unauthorized',
      'DigitalOcean rejected that token. Check it was copied in full and has not been revoked.',
      'apiToken',
    );
  }
  if (response.status === 403) {
    throw new DnsProviderError(
      'forbidden',
      `Your DigitalOcean token isn't allowed to ${action}. It needs write scope.`,
      'apiToken',
    );
  }
  if (response.status === 422) {
    throw new DnsProviderError(
      'conflict',
      `DigitalOcean refused to ${action}${message ? `: ${message}` : '.'}`,
    );
  }
  throw new DnsProviderError(
    codeForStatus(response.status),
    `DigitalOcean could not ${action}${message ? `: ${message}` : '.'}`,
  );
}

function safeParseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
