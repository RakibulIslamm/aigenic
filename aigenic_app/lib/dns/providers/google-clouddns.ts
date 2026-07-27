import 'server-only';
import { createSign } from 'node:crypto';
import { z } from 'zod';
import { DNS_PROVIDER_META } from '@/lib/dns/catalog';
import { DnsProviderError, codeForStatus } from '@/lib/dns/errors';
import { normalizeName, parseJson, providerFetch } from '@/lib/dns/http';
import type {
  DnsCredentials,
  DnsProvider,
  DnsRecord,
  DnsZone,
  UpsertRecordInput,
  UpsertRecordResult,
} from '@/lib/dns/types';

/**
 * Google Cloud DNS (API v1), authenticated with a service-account key.
 *
 * There is no long-lived API key here — Google wants an OAuth2 access token,
 * and the way to get one without a browser is the JWT bearer grant: build a
 * claim set, sign it RS256 with the key file's private key, POST it to the
 * token endpoint, get an hour-long token back. That whole exchange is
 * `accessToken()` below, and it's the only reason this adapter is longer than
 * the others.
 *
 * Two Cloud DNS semantics matter:
 *
 *  - **Names are absolute, with a trailing dot.** `dnsName` already ends in
 *    one, so the crawl record's name is built by prefixing it rather than by
 *    string surgery on the user's domain.
 *  - **It is record-*set* oriented.** `(name, type)` is one resource, so a
 *    second POST at the same name is a 409 rather than a second record. The
 *    update path is PATCH on `…/rrsets/{name}/{type}`.
 *
 * Docs: https://docs.cloud.google.com/dns/docs/reference/rest/v1/
 */

const DNS_BASE_URL = 'https://dns.googleapis.com/dns/v1';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/ndev.clouddns.readwrite';
/** Google's maximum assertion lifetime is one hour. */
const TOKEN_LIFETIME_SECONDS = 3_600;
const MAX_PAGES = 10;

const serviceAccountSchema = z.object({
  type: z.string().optional(),
  project_id: z.string().min(1, 'The key file has no project_id.'),
  private_key: z.string().min(1, 'The key file has no private_key.'),
  client_email: z.string().min(1, 'The key file has no client_email.'),
  token_uri: z.string().optional(),
});

const zonesSchema = z.object({
  managedZones: z
    .array(
      z.object({
        name: z.string(),
        dnsName: z.string(),
        visibility: z.string().optional(),
      }),
    )
    .nullable()
    .optional(),
  nextPageToken: z.string().optional(),
});

const rrsetsSchema = z.object({
  rrsets: z
    .array(
      z.object({
        name: z.string(),
        type: z.string(),
        ttl: z.number().optional(),
        rrdatas: z.array(z.string()).nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  nextPageToken: z.string().optional(),
});

const googleErrorSchema = z.object({
  error: z
    .object({
      code: z.number().optional(),
      message: z.string().optional(),
      status: z.string().optional(),
      errors: z.array(z.object({ reason: z.string().optional() })).optional(),
    })
    .optional(),
  error_description: z.string().optional(),
});

export const googleCloudDnsProvider: DnsProvider = {
  ...DNS_PROVIDER_META['google-clouddns'],

  parseCredentials(raw) {
    const text = (raw.serviceAccountJson ?? '').trim();
    if (!text) {
      throw new DnsProviderError(
        'invalid_credentials',
        'Paste the service-account JSON key file.',
        'serviceAccountJson',
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new DnsProviderError(
        'invalid_credentials',
        "That isn't valid JSON. Paste the key file exactly as Google downloaded it.",
        'serviceAccountJson',
      );
    }

    const parsed = serviceAccountSchema.safeParse(json);
    if (!parsed.success) {
      throw new DnsProviderError(
        'invalid_credentials',
        parsed.error.issues[0]?.message ??
          "That JSON doesn't look like a service-account key.",
        'serviceAccountJson',
      );
    }

    // Store the file verbatim plus the project id, so nothing downstream has
    // to re-parse a multi-kilobyte blob to build a URL.
    return { serviceAccountJson: text, projectId: parsed.data.project_id };
  },

  async verify(credentials) {
    const account = serviceAccount(credentials);
    const response = await call(
      credentials,
      `${DNS_BASE_URL}/projects/${encodeURIComponent(account.project_id)}`,
    );
    expectOk(response, 'check your Google Cloud credentials');
    return { label: `Google Cloud DNS · ${account.project_id}` };
  },

  async listZones(credentials) {
    const account = serviceAccount(credentials);
    const zones: DnsZone[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(
        `${DNS_BASE_URL}/projects/${encodeURIComponent(account.project_id)}/managedZones`,
      );
      url.searchParams.set('maxResults', '100');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const response = await call(credentials, url.toString());
      expectOk(response, 'list your Cloud DNS zones');

      const parsed = zonesSchema.safeParse(parseJson(response));
      if (!parsed.success) break;
      for (const zone of parsed.data.managedZones ?? []) {
        // A private zone only answers inside a VPC, so it can never serve a
        // crawl host our VPS has to resolve from the public internet.
        if (zone.visibility && zone.visibility !== 'public') continue;
        zones.push({ id: zone.name, name: normalizeName(zone.dnsName) });
      }
      pageToken = parsed.data.nextPageToken;
      if (!pageToken) break;
    }
    return zones;
  },

  async listRecords(credentials, zone) {
    const account = serviceAccount(credentials);
    const records: DnsRecord[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(
        `${DNS_BASE_URL}/projects/${encodeURIComponent(account.project_id)}/managedZones/${encodeURIComponent(zone.id)}/rrsets`,
      );
      url.searchParams.set('maxResults', '300');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const response = await call(credentials, url.toString());
      expectOk(response, `read the ${zone.name} zone`);

      const parsed = rrsetsSchema.safeParse(parseJson(response));
      if (!parsed.success) break;
      for (const rrset of parsed.data.rrsets ?? []) {
        for (const value of rrset.rrdatas ?? []) {
          records.push({
            id: null,
            name: normalizeName(rrset.name),
            type: rrset.type.toUpperCase(),
            value,
            ttl: rrset.ttl ?? null,
          });
        }
      }
      pageToken = parsed.data.nextPageToken;
      if (!pageToken) break;
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
  const account = serviceAccount(credentials);
  const { zone, name, type, value, ttl } = input;
  const fqdn = `${name}.`;
  const base = `${DNS_BASE_URL}/projects/${encodeURIComponent(account.project_id)}/managedZones/${encodeURIComponent(zone.id)}/rrsets`;
  const body = JSON.stringify({ name: fqdn, type, ttl, rrdatas: [value] });

  const created = await call(credentials, base, { method: 'POST', body });
  if (created.ok) return { recordId: `${fqdn}/${type}`, updated: false };

  // A record set already occupying (name, type) is the expected case on a
  // re-run, and the only way to change it is PATCH — POST will 409 forever.
  if (reasonOf(created) === 'alreadyExists') {
    const patch = await call(
      credentials,
      `${base}/${encodeURIComponent(fqdn)}/${encodeURIComponent(type)}`,
      { method: 'PATCH', body: JSON.stringify({ ttl, rrdatas: [value] }) },
    );
    expectOk(patch, `update ${name}`);
    return { recordId: `${fqdn}/${type}`, updated: true };
  }

  expectOk(created, `create ${name}`);
  return { recordId: `${fqdn}/${type}`, updated: false };
}

function serviceAccount(
  credentials: DnsCredentials,
): z.infer<typeof serviceAccountSchema> {
  let json: unknown;
  try {
    json = JSON.parse(credentials.serviceAccountJson ?? '');
  } catch {
    throw new DnsProviderError(
      'invalid_credentials',
      'The stored Google Cloud key could not be read. Reconnect the provider.',
    );
  }
  const parsed = serviceAccountSchema.safeParse(json);
  if (!parsed.success) {
    throw new DnsProviderError(
      'invalid_credentials',
      'The stored Google Cloud key is missing required fields. Reconnect the provider.',
    );
  }
  return parsed.data;
}

/**
 * Exchanges the service-account key for an access token.
 *
 * Not cached: a server action runs one or two DNS calls and ends, so a cache
 * would live exactly as long as the request that filled it while adding a
 * place for a stale token to hide. The exchange is one round trip.
 */
async function accessToken(credentials: DnsCredentials): Promise<string> {
  const account = serviceAccount(credentials);
  const tokenUri = account.token_uri ?? DEFAULT_TOKEN_URI;
  const issuedAt = Math.floor(Date.now() / 1000);

  const assertion = signJwt(
    {
      iss: account.client_email,
      scope: SCOPE,
      aud: tokenUri,
      iat: issuedAt,
      exp: issuedAt + TOKEN_LIFETIME_SECONDS,
    },
    account.private_key,
  );

  const response = await providerFetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  if (!response.ok) {
    const parsed = googleErrorSchema.safeParse(safeJson(response.body));
    const description = parsed.success ? parsed.data.error_description : undefined;
    throw new DnsProviderError(
      'unauthorized',
      'Google rejected that service-account key' +
        (description
          ? `: ${description}`
          : '. Check it has not been deleted or disabled.'),
      'serviceAccountJson',
    );
  }

  const token = z
    .object({ access_token: z.string() })
    .safeParse(parseJson<unknown>(response));
  if (!token.success) {
    throw new DnsProviderError(
      'unavailable',
      'Google returned a token response we could not read.',
    );
  }
  return token.data.access_token;
}

function signJwt(claims: Record<string, string | number>, privateKeyPem: string): string {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;

  // Key files pasted out of an environment variable often carry literal `\n`
  // two-character sequences instead of newlines; PEM parsing fails on those
  // with an error that says nothing about the cause.
  const pem = privateKeyPem.includes('\\n')
    ? privateKeyPem.replace(/\\n/g, '\n')
    : privateKeyPem;

  let signature: string;
  try {
    signature = createSign('RSA-SHA256')
      .update(signingInput)
      .sign(pem)
      .toString('base64url');
  } catch {
    throw new DnsProviderError(
      'invalid_credentials',
      "The private key in that file couldn't be used to sign a request. Download a fresh key.",
      'serviceAccountJson',
    );
  }

  return `${signingInput}.${signature}`;
}

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

async function call(
  credentials: DnsCredentials,
  url: string,
  init: { method?: string; body?: string } = {},
) {
  const token = await accessToken(credentials);
  return providerFetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}

function reasonOf(response: { body: string }): string | null {
  const parsed = googleErrorSchema.safeParse(safeJson(response.body));
  if (!parsed.success) return null;
  return (
    parsed.data.error?.errors?.[0]?.reason ??
    (parsed.data.error?.status === 'ALREADY_EXISTS' ? 'alreadyExists' : null)
  );
}

function expectOk(
  response: { status: number; ok: boolean; body: string },
  action: string,
) {
  if (response.ok) return;

  const parsed = googleErrorSchema.safeParse(safeJson(response.body));
  const message = parsed.success ? parsed.data.error?.message : undefined;
  const reason = reasonOf(response);

  if (reason === 'accessNotConfigured') {
    throw new DnsProviderError(
      'forbidden',
      'The Cloud DNS API is not enabled on that project. Enable dns.googleapis.com, then reconnect.',
    );
  }
  if (reason === 'cnameResourceRecordSetConflict') {
    throw new DnsProviderError(
      'conflict',
      'A CNAME already exists at that name. Remove it first — DNS does not allow a CNAME ' +
        'and an A record to share a name.',
    );
  }
  if (response.status === 401) {
    throw new DnsProviderError(
      'unauthorized',
      'Google rejected that service-account key.',
      'serviceAccountJson',
    );
  }
  if (response.status === 403) {
    throw new DnsProviderError(
      'forbidden',
      `That service account isn't allowed to ${action}. Grant it the DNS Administrator role.`,
    );
  }
  if (response.status === 404) {
    throw new DnsProviderError(
      'not_found',
      `Google Cloud could not find what we asked for while trying to ${action}.`,
    );
  }

  throw new DnsProviderError(
    codeForStatus(response.status),
    `Google Cloud DNS could not ${action}${message ? `: ${message}` : '.'}`,
  );
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
