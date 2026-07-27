import 'server-only';
import { z } from 'zod';
import { DNS_PROVIDER_META } from '@/lib/dns/catalog';
import { DnsProviderError, codeForStatus } from '@/lib/dns/errors';
import {
  escapeXml,
  normalizeName,
  providerFetch,
  xmlBlocks,
  xmlValue,
} from '@/lib/dns/http';
import { signAwsRequest } from '@/lib/dns/sigv4';
import type {
  DnsCredentials,
  DnsProvider,
  DnsRecord,
  DnsZone,
  UpsertRecordInput,
  UpsertRecordResult,
} from '@/lib/dns/types';

/**
 * Amazon Route 53, signed by hand (see `lib/dns/sigv4.ts`).
 *
 * Three Route 53 quirks are load-bearing here:
 *
 *  - **It is a global service signed against `us-east-1`.** There is no
 *    regional endpoint to choose, and signing with the customer's "usual"
 *    region produces a signature Amazon rejects.
 *  - **`ListResourceRecordSets`' `name`/`type` are a paging cursor, not a
 *    filter.** Results start at the first record ≥ `name` and run to the end
 *    of the zone, so every lookup filters client-side. Passing `type` without
 *    `name` is an outright `InvalidInput`.
 *  - **`UPSERT` is natively idempotent**, so unlike the other four providers
 *    this one needs no read-then-decide dance to create-or-update. The read it
 *    does do is only to report "created" vs "updated" honestly.
 *
 * Docs: https://docs.aws.amazon.com/Route53/latest/APIReference/API_ChangeResourceRecordSets.html
 */

const HOST = 'route53.amazonaws.com';
const API_PREFIX = '/2013-04-01';
const XMLNS = 'https://route53.amazonaws.com/doc/2013-04-01/';
/** Route 53 is global; requests are signed against us-east-1 everywhere. */
const SIGNING_REGION = 'us-east-1';
const SERVICE = 'route53';
const MAX_PAGES = 10;

const credentialsSchema = z.object({
  accessKeyId: z
    .string()
    .trim()
    .min(16, 'An AWS access key ID is at least 16 characters.')
    .max(128),
  secretAccessKey: z
    .string()
    .trim()
    .min(20, 'That does not look like an AWS secret access key.')
    .max(256),
  sessionToken: z.string().trim().max(4096).optional(),
});

export const route53Provider: DnsProvider = {
  ...DNS_PROVIDER_META.route53,

  parseCredentials(raw) {
    const parsed = credentialsSchema.safeParse({
      accessKeyId: raw.accessKeyId ?? '',
      secretAccessKey: raw.secretAccessKey ?? '',
      ...(raw.sessionToken ? { sessionToken: raw.sessionToken } : {}),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new DnsProviderError(
        'invalid_credentials',
        issue?.message ?? 'Enter your AWS access keys.',
        issue?.path[0] ? String(issue.path[0]) : undefined,
      );
    }
    return {
      accessKeyId: parsed.data.accessKeyId,
      secretAccessKey: parsed.data.secretAccessKey,
      ...(parsed.data.sessionToken ? { sessionToken: parsed.data.sessionToken } : {}),
    };
  },

  async verify(credentials) {
    // Cheapest call that exercises the exact permission we need next.
    const response = await call(credentials, {
      method: 'GET',
      path: `${API_PREFIX}/hostedzone`,
      query: { maxitems: '1' },
    });
    expectOk(response, 'check your AWS credentials');
    return { label: `Route 53 · ${credentials.accessKeyId ?? 'AWS'}` };
  },

  async listZones(credentials) {
    const zones: DnsZone[] = [];
    let marker: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await call(credentials, {
        method: 'GET',
        path: `${API_PREFIX}/hostedzone`,
        query: { maxitems: '100', ...(marker ? { marker } : {}) },
      });
      expectOk(response, 'list your Route 53 hosted zones');

      for (const block of xmlBlocks(response.body, 'HostedZone')) {
        // A private zone only resolves inside a VPC — useless for a crawl
        // host that has to be reachable from our VPS.
        if (xmlValue(block, 'PrivateZone') === 'true') continue;
        const id = xmlValue(block, 'Id');
        const name = xmlValue(block, 'Name');
        if (!id || !name) continue;
        zones.push({ id: stripZonePrefix(id), name: normalizeName(name) });
      }

      if (xmlValue(response.body, 'IsTruncated') !== 'true') break;
      marker = xmlValue(response.body, 'NextMarker') ?? undefined;
      if (!marker) break;
    }
    return zones;
  },

  async listRecords(credentials, zone) {
    const records: DnsRecord[] = [];
    let startName: string | undefined;
    let startType: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await call(credentials, {
        method: 'GET',
        path: `${API_PREFIX}/hostedzone/${encodeURIComponent(zone.id)}/rrset`,
        query: {
          maxitems: '300',
          // `type` without `name` is rejected outright, so they move together.
          ...(startName ? { name: startName } : {}),
          ...(startName && startType ? { type: startType } : {}),
        },
      });
      expectOk(response, `read the ${zone.name} zone`);

      for (const block of xmlBlocks(response.body, 'ResourceRecordSet')) {
        const parsed = parseRecordSet(block);
        if (parsed) records.push(...parsed);
      }

      if (xmlValue(response.body, 'IsTruncated') !== 'true') break;
      startName = xmlValue(response.body, 'NextRecordName') ?? undefined;
      startType = xmlValue(response.body, 'NextRecordType') ?? undefined;
      if (!startName) break;
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
  const fqdn = `${name}.`;

  const updated = await recordExists(credentials, zone, name, type);

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<ChangeResourceRecordSetsRequest xmlns="${XMLNS}">` +
    `<ChangeBatch>` +
    `<Comment>Created by Aigenic so its crawler can reach this origin directly</Comment>` +
    `<Changes><Change>` +
    // UPSERT, not CREATE: pressing the button twice, or pressing it after the
    // origin moved, both have to end with the record pointing at `value`.
    `<Action>UPSERT</Action>` +
    `<ResourceRecordSet>` +
    `<Name>${escapeXml(fqdn)}</Name>` +
    `<Type>${type}</Type>` +
    `<TTL>${ttl}</TTL>` +
    `<ResourceRecords><ResourceRecord><Value>${escapeXml(value)}</Value></ResourceRecord></ResourceRecords>` +
    `</ResourceRecordSet>` +
    `</Change></Changes>` +
    `</ChangeBatch>` +
    `</ChangeResourceRecordSetsRequest>`;

  const response = await call(credentials, {
    method: 'POST',
    path: `${API_PREFIX}/hostedzone/${encodeURIComponent(zone.id)}/rrset/`,
    body,
    contentType: 'application/xml',
  });
  expectOk(response, `create ${name}`);

  // Route 53 record sets have no stable id of their own — name + type is the
  // identity, and that's already stored on the site row.
  return { recordId: null, updated };
}

/** One start-position read, then an exact match check — see the note above. */
async function recordExists(
  credentials: DnsCredentials,
  zone: DnsZone,
  name: string,
  type: string,
): Promise<boolean> {
  try {
    const response = await call(credentials, {
      method: 'GET',
      path: `${API_PREFIX}/hostedzone/${encodeURIComponent(zone.id)}/rrset`,
      query: { name: `${name}.`, type, maxitems: '1' },
    });
    if (!response.ok) return false;
    const first = xmlBlocks(response.body, 'ResourceRecordSet')[0];
    if (!first) return false;
    return (
      normalizeName(xmlValue(first, 'Name') ?? '') === name &&
      (xmlValue(first, 'Type') ?? '').toUpperCase() === type
    );
  } catch {
    // Reporting "created" instead of "updated" is cosmetic; failing the whole
    // operation over it would not be.
    return false;
  }
}

function parseRecordSet(block: string): DnsRecord[] | null {
  const rawName = xmlValue(block, 'Name');
  const type = xmlValue(block, 'Type');
  if (!rawName || !type) return null;

  const name = normalizeName(decodeOctalEscapes(rawName));
  const ttlText = xmlValue(block, 'TTL');
  const ttl = ttlText ? Number(ttlText) : null;

  // An alias record has no ResourceRecords and no TTL — it points at an AWS
  // resource. Surfacing it as ALIAS is what lets origin detection say "your
  // apex is aliased" instead of "no records found".
  const aliasDnsName = xmlValue(block, 'DNSName');
  if (aliasDnsName && xmlBlocks(block, 'ResourceRecord').length === 0) {
    return [
      { id: null, name, type: 'ALIAS', value: normalizeName(aliasDnsName), ttl: null },
    ];
  }

  return xmlBlocks(block, 'ResourceRecord')
    .map((record) => xmlValue(record, 'Value'))
    .filter((value): value is string => Boolean(value))
    .map((value) => ({
      id: null,
      name,
      type: type.toUpperCase(),
      value,
      ttl: Number.isFinite(ttl) ? ttl : null,
    }));
}

/** Route 53 returns non-ASCII and `*` labels as `\052`-style octal escapes. */
function decodeOctalEscapes(name: string): string {
  return name.replace(/\\(\d{3})/g, (_, octal: string) =>
    String.fromCharCode(parseInt(octal, 8)),
  );
}

function stripZonePrefix(id: string): string {
  return id.replace(/^\/hostedzone\//, '');
}

async function call(
  credentials: DnsCredentials,
  request: {
    method: string;
    path: string;
    query?: Record<string, string>;
    body?: string;
    contentType?: string;
  },
) {
  const accessKeyId = credentials.accessKeyId ?? '';
  const secretAccessKey = credentials.secretAccessKey ?? '';
  const signed = signAwsRequest({
    request: {
      method: request.method,
      host: HOST,
      path: request.path,
      ...(request.query ? { query: request.query } : {}),
      ...(request.body === undefined ? {} : { body: request.body }),
      ...(request.contentType ? { contentType: request.contentType } : {}),
    },
    credentials: {
      accessKeyId,
      secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
    region: SIGNING_REGION,
    service: SERVICE,
  });

  return providerFetch(signed.url, {
    method: request.method,
    headers: signed.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
  });
}

function expectOk(
  response: { status: number; ok: boolean; body: string },
  action: string,
) {
  if (response.ok) return;

  const code = xmlValue(response.body, 'Code');
  // `InvalidChangeBatch` is a different shape: a list of <Message> entries
  // instead of a single <Error><Code>, one per problem in the batch.
  const message =
    xmlValue(response.body, 'Message') ?? xmlValue(response.body, 'message') ?? null;

  if (code === 'InvalidClientTokenId' || code === 'UnrecognizedClientException') {
    throw new DnsProviderError(
      'unauthorized',
      'AWS does not recognise that access key ID.',
      'accessKeyId',
    );
  }
  if (code === 'SignatureDoesNotMatch' || code === 'IncompleteSignature') {
    throw new DnsProviderError(
      'unauthorized',
      'AWS rejected the request signature — check the secret access key was copied in full.',
      'secretAccessKey',
    );
  }
  if (code === 'ExpiredToken' || code === 'ExpiredTokenException') {
    throw new DnsProviderError(
      'unauthorized',
      'Those temporary AWS credentials have expired. Reconnect with fresh ones.',
      'sessionToken',
    );
  }
  if (
    code === 'AccessDenied' ||
    code === 'AccessDeniedException' ||
    response.status === 403
  ) {
    throw new DnsProviderError(
      'forbidden',
      `That IAM identity isn't allowed to ${action}. It needs route53:ListHostedZones, ` +
        'route53:ListResourceRecordSets and route53:ChangeResourceRecordSets.',
    );
  }
  if (code === 'NoSuchHostedZone') {
    throw new DnsProviderError(
      'not_found',
      'That hosted zone no longer exists in Route 53.',
    );
  }
  if (code === 'PriorRequestNotComplete') {
    throw new DnsProviderError(
      'rate_limited',
      'Route 53 is still applying a previous change to this zone. Try again in a few seconds.',
    );
  }

  throw new DnsProviderError(
    codeForStatus(response.status),
    `Route 53 could not ${action}${message ? `: ${message}` : '.'}`,
  );
}
