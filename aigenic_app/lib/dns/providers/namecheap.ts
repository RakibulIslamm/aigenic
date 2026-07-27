import 'server-only';
import { z } from 'zod';
import { DNS_PROVIDER_META } from '@/lib/dns/catalog';
import { DnsProviderError } from '@/lib/dns/errors';
import {
  decodeXmlEntities,
  normalizeName,
  providerFetch,
  xmlAttr,
  xmlElements,
} from '@/lib/dns/http';
import { relativeRecordName } from '@/lib/sites/domains';
import type {
  DnsCredentials,
  DnsProvider,
  DnsZone,
  UpsertRecordInput,
  UpsertRecordResult,
} from '@/lib/dns/types';

/**
 * Namecheap's XML API.
 *
 * This is the awkward one, and the awkwardness is not incidental — it changes
 * what the code has to do:
 *
 *  - **`setHosts` replaces the entire zone.** There is no "add one record"
 *    call. Anything not included in the write is deleted. So creating one
 *    record means reading every existing host, re-serialising all of them into
 *    indexed parameters, appending ours, and sending the lot. A missed record
 *    is a deleted record.
 *  - **`EmailType` has to be echoed back.** Email routing is stored beside the
 *    host rows, not in them, so faithfully re-sending every `Host` and
 *    omitting `EmailType` still resets the domain's mail configuration. That's
 *    someone's email going down because we added a subdomain.
 *  - **Errors arrive as HTTP 200.** `ApiResponse/@Status` is the real status,
 *    and `setHosts` has a second one: `DomainDNSSetHostsResult/@IsSuccess`
 *    can be false under an `OK` envelope.
 *  - **Requests must come from an allowlisted IPv4 address** — the caller's,
 *    not the customer's. That's a deployment property, so it's surfaced as a
 *    caveat rather than discovered as a mystery error.
 *
 * Docs: https://www.namecheap.com/support/api/methods/domains-dns/set-hosts/
 */

const API_URL = 'https://api.namecheap.com/xml.response';
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
/** Namecheap accepts 60–60000; anything outside is rejected for the whole call. */
const MIN_TTL = 60;
const MAX_TTL = 60_000;

const credentialsSchema = z.object({
  apiUser: z.string().trim().min(1, 'Enter your Namecheap API user.').max(20),
  apiKey: z
    .string()
    .trim()
    .min(10, 'That does not look like a Namecheap API key.')
    .max(50),
  username: z.string().trim().max(20).optional(),
  clientIp: z
    .string()
    .trim()
    .regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'Namecheap only accepts an IPv4 address here.'),
});

/** One host row, in the shape `setHosts` needs to send it back. */
interface NamecheapHost {
  name: string;
  type: string;
  address: string;
  mxPref: string;
  ttl: string;
}

export const namecheapProvider: DnsProvider = {
  ...DNS_PROVIDER_META.namecheap,

  parseCredentials(raw) {
    const parsed = credentialsSchema.safeParse({
      apiUser: raw.apiUser ?? '',
      apiKey: raw.apiKey ?? '',
      clientIp: raw.clientIp ?? '',
      ...(raw.username ? { username: raw.username } : {}),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new DnsProviderError(
        'invalid_credentials',
        issue?.message ?? 'Check your Namecheap API details.',
        issue?.path[0] ? String(issue.path[0]) : undefined,
      );
    }
    return {
      apiUser: parsed.data.apiUser,
      apiKey: parsed.data.apiKey,
      username: parsed.data.username ?? parsed.data.apiUser,
      clientIp: parsed.data.clientIp,
    };
  },

  async verify(credentials) {
    // No dedicated auth endpoint exists, and getList is the cheapest call that
    // proves the key works — it also warms the zone picker's next step.
    await fetchDomains(credentials, 1);
    return { label: `Namecheap · ${credentials.apiUser ?? ''}` };
  },

  async listZones(credentials) {
    const zones: DnsZone[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const xml = await fetchDomains(credentials, page);
      const domains = xmlElements(xml, 'Domain');
      for (const domain of domains) {
        const name = domain.name ? normalizeName(domain.name) : null;
        if (!name) continue;
        // Domains on external nameservers would let us write records nobody
        // resolves, and a locked domain rejects every change — neither belongs
        // in a picker whose next button creates a record.
        if (domain.isourdns === 'false') continue;
        if (domain.islocked === 'true') continue;
        if (domain.isexpired === 'true') continue;
        zones.push({ id: name, name });
      }
      if (domains.length < PAGE_SIZE) break;
    }
    return zones;
  },

  async listRecords(credentials, zone) {
    const { hosts } = await fetchHosts(credentials, zone.name);
    return hosts.map((host) => ({
      id: null,
      name: absoluteName(host.name, zone.name),
      type: host.type.toUpperCase(),
      value: host.address,
      ttl: Number.isFinite(Number(host.ttl)) ? Number(host.ttl) : null,
    }));
  },

  async upsertRecord(credentials, input) {
    return upsertRecord(credentials, input);
  },
};

/**
 * Read the whole zone, splice our record in, write the whole zone back.
 *
 * The splice is by (name, type) so a re-run replaces our previous record
 * rather than adding a second one — Namecheap would happily store both and
 * round-robin between a live origin and a dead one.
 */
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

  const { hosts, emailType } = await fetchHosts(credentials, zone.name);

  const target = relative.toLowerCase();
  const existingIndex = hosts.findIndex(
    (host) => host.name.toLowerCase() === target && host.type.toUpperCase() === type,
  );
  const replacement: NamecheapHost = {
    name: relative,
    type,
    address: value,
    mxPref: '10',
    ttl: String(clampTtl(ttl)),
  };

  const next = [...hosts];
  if (existingIndex >= 0) next[existingIndex] = replacement;
  else next.push(replacement);

  const params: Record<string, string> = {
    ...globalParams(credentials, 'namecheap.domains.dns.setHosts'),
    ...splitDomain(zone.name),
  };
  // Email routing lives outside the host rows: re-sending every record but
  // dropping EmailType still resets the domain's mail configuration.
  if (emailType) params.EmailType = emailType;

  next.forEach((host, index) => {
    const n = index + 1;
    params[`HostName${n}`] = host.name;
    params[`RecordType${n}`] = host.type;
    params[`Address${n}`] = host.address;
    params[`MXPref${n}`] = host.mxPref;
    params[`TTL${n}`] = host.ttl;
  });

  // POST, not GET: a zone with 30 records is 150 indexed parameters, which is
  // past what a query string can carry reliably.
  const response = await providerFetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const xml = expectOk(response, `update the ${zone.name} zone`);

  if (xmlAttr(xml, 'DomainDNSSetHostsResult', 'IsSuccess') !== 'true') {
    throw new DnsProviderError(
      'unavailable',
      `Namecheap accepted the request but reported that the ${zone.name} zone was not updated.`,
    );
  }

  // Namecheap host ids aren't accepted on write, so they aren't an identity we
  // can store and reuse — name plus type is.
  return { recordId: null, updated: existingIndex >= 0 };
}

async function fetchDomains(credentials: DnsCredentials, page: number): Promise<string> {
  const params = new URLSearchParams({
    ...globalParams(credentials, 'namecheap.domains.getList'),
    ListType: 'ALL',
    Page: String(page),
    PageSize: String(PAGE_SIZE),
    SortBy: 'NAME',
  });
  const response = await providerFetch(`${API_URL}?${params.toString()}`);
  return expectOk(response, 'list your Namecheap domains');
}

async function fetchHosts(
  credentials: DnsCredentials,
  zoneName: string,
): Promise<{ hosts: NamecheapHost[]; emailType: string | null }> {
  const params = new URLSearchParams({
    ...globalParams(credentials, 'namecheap.domains.dns.getHosts'),
    ...splitDomain(zoneName),
  });
  const response = await providerFetch(`${API_URL}?${params.toString()}`);
  const xml = expectOk(response, `read the ${zoneName} zone`);

  if (xmlAttr(xml, 'DomainDNSGetHostsResult', 'IsUsingOurDNS') === 'false') {
    throw new DnsProviderError(
      'unsupported',
      `${zoneName} isn't using Namecheap's nameservers, so records changed here wouldn't ` +
        'resolve. Connect the provider that actually hosts this zone.',
    );
  }

  const hosts = xmlElements(xml, 'Host').flatMap<NamecheapHost>((host) => {
    if (!host.name || !host.type) return [];
    return [
      {
        name: host.name,
        type: host.type,
        address: host.address ?? '',
        mxPref: host.mxpref ?? '10',
        ttl: String(clampTtl(Number(host.ttl ?? '1800'))),
      },
    ];
  });

  return { hosts, emailType: xmlAttr(xml, 'DomainDNSGetHostsResult', 'EmailType') };
}

function globalParams(
  credentials: DnsCredentials,
  command: string,
): Record<string, string> {
  return {
    ApiUser: credentials.apiUser ?? '',
    ApiKey: credentials.apiKey ?? '',
    UserName: credentials.username ?? credentials.apiUser ?? '',
    ClientIp: credentials.clientIp ?? '',
    Command: command,
  };
}

/**
 * Namecheap wants the domain pre-split. The split is on the *first* label, so
 * `example.co.uk` is `SLD=example`, `TLD=co.uk` — splitting on the last dot
 * would ask for the non-existent `example.co` domain.
 */
function splitDomain(zoneName: string): { SLD: string; TLD: string } {
  const [sld, ...rest] = zoneName.split('.');
  if (!sld || rest.length === 0) {
    throw new DnsProviderError('not_found', `${zoneName} is not a domain we can split.`);
  }
  return { SLD: sld, TLD: rest.join('.') };
}

function absoluteName(relative: string, zoneName: string): string {
  const name = relative.trim().toLowerCase().replace(/\.$/, '');
  if (name === '@' || name === '') return zoneName;
  if (name === zoneName || name.endsWith(`.${zoneName}`)) return name;
  return `${name}.${zoneName}`;
}

function clampTtl(ttl: number): number {
  if (!Number.isFinite(ttl)) return 1800;
  return Math.min(MAX_TTL, Math.max(MIN_TTL, Math.round(ttl)));
}

/** Namecheap answers 200 for failures, so the XML envelope is the real status. */
function expectOk(response: { status: number; body: string }, action: string): string {
  const xml = response.body;

  if (xmlAttr(xml, 'ApiResponse', 'Status')?.toUpperCase() === 'OK') return xml;

  const errors = parseErrors(xml);
  const numbers = new Set(errors.map((error) => error.number));

  if (numbers.has('1017150') || numbers.has('1017105') || numbers.has('1011150')) {
    throw new DnsProviderError(
      'forbidden',
      "Namecheap refused the request because our server's IP address isn't on your API " +
        'allowlist. Add the address shown above under Profile → Tools → Namecheap API Access.',
      'clientIp',
    );
  }
  if (
    numbers.has('1010102') ||
    numbers.has('1011102') ||
    numbers.has('1017101') ||
    numbers.has('1017411')
  ) {
    throw new DnsProviderError(
      'unauthorized',
      'Namecheap rejected those API credentials. Check the API key and that API access is enabled.',
      'apiKey',
    );
  }
  if (numbers.has('1016103') || numbers.has('1019103') || numbers.has('1017103')) {
    throw new DnsProviderError(
      'unauthorized',
      'Namecheap did not accept that account username.',
      'username',
    );
  }
  if (numbers.has('2019166') || numbers.has('2016166')) {
    throw new DnsProviderError(
      'not_found',
      'That domain is not in this Namecheap account.',
    );
  }
  if (numbers.has('2030288') || numbers.has('3011288')) {
    throw new DnsProviderError(
      'unsupported',
      "That domain isn't using Namecheap's nameservers, so records changed here wouldn't resolve.",
    );
  }

  const detail = errors.find((error) => error.message)?.message;
  throw new DnsProviderError(
    'unavailable',
    `Namecheap could not ${action}${detail ? `: ${detail}` : '.'}`,
  );
}

function parseErrors(xml: string): Array<{ number: string; message: string }> {
  const out: Array<{ number: string; message: string }> = [];
  const re = /<Error\b[^>]*\bNumber\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/Error>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    out.push({
      number: match[1] ?? '',
      message: decodeXmlEntities(match[2] ?? '').trim(),
    });
  }
  return out;
}
