/**
 * The common shape every DNS provider is adapted to.
 *
 * Five providers, five wire formats — Cloudflare's `{success, result}` JSON,
 * Route 53's signed XML, DigitalOcean's plain JSON, Namecheap's indexed
 * query-string XML, Google's OAuth2-bearer JSON. None of that belongs above
 * this line. Everything upstream (the server actions, the UI, the crawl
 * dispatcher) speaks only in zones, records and one `upsertRecord` call.
 *
 * The interface is deliberately narrow — four operations, no delete, no
 * generic record CRUD. This exists to create exactly one record per site, and
 * a wider surface would mean five more implementations to keep correct for a
 * capability nothing asks for.
 */

export const DNS_PROVIDER_IDS = [
  'cloudflare',
  'route53',
  'digitalocean',
  'namecheap',
  'google-clouddns',
] as const;

export type DnsProviderId = (typeof DNS_PROVIDER_IDS)[number];

export function isDnsProviderId(value: string): value is DnsProviderId {
  return (DNS_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Credentials as stored: a flat string map, encrypted as one JSON blob.
 * Providers own their own key names and validate them in `parseCredentials`,
 * which is what keeps the registry homogeneous without a union type that every
 * caller would have to narrow.
 */
export type DnsCredentials = Record<string, string>;

/** One input on the "connect provider" form. */
export interface CredentialField {
  name: string;
  label: string;
  /** `password` masks the input; `textarea` is for pasted JSON key files. */
  type: 'text' | 'password' | 'textarea';
  placeholder?: string;
  /** One line under the input — where to find this value, mostly. */
  help?: string;
  optional?: boolean;
}

export interface DnsZone {
  /** Provider-side identifier used in subsequent calls. */
  id: string;
  /** Apex name, no trailing dot, lowercased — e.g. `example.com`. */
  name: string;
}

export interface DnsRecord {
  /** Provider-side id. Null for providers with no per-record identity. */
  id: string | null;
  /** Absolute name, no trailing dot, lowercased. */
  name: string;
  type: string;
  /** The record's value — an IP for A/AAAA, a hostname for CNAME. */
  value: string;
  ttl: number | null;
  /** Cloudflare only: whether the record is behind the orange cloud. */
  proxied?: boolean;
}

export interface UpsertRecordInput {
  zone: DnsZone;
  /** Absolute name, no trailing dot — e.g. `crawl.example.com`. */
  name: string;
  type: 'A' | 'AAAA';
  value: string;
  ttl: number;
}

export interface UpsertRecordResult {
  /** Provider-side record id when there is one, else null. */
  recordId: string | null;
  /** True when an existing record was updated rather than created. */
  updated: boolean;
}

export interface VerifiedCredentials {
  /**
   * How to name this connection in the UI — an account email, token name or
   * access-key id. Never secret: it is stored in a plain column and rendered
   * to the browser.
   */
  label: string;
}

/**
 * Everything the connect form needs to render a provider — and nothing that
 * touches the network. Split out of `DnsProvider` so the client component can
 * import the catalogue without dragging five `server-only` adapters (and
 * `node:crypto`) into the browser bundle.
 */
export interface DnsProviderMeta {
  readonly id: DnsProviderId;
  readonly label: string;
  /** Where to get the credentials, linked from the connect form. */
  readonly docsUrl: string;
  /** One or two sentences shown above the form. Plain text, no markup. */
  readonly help: string;
  /**
   * Warnings the user must read *before* connecting — Namecheap's IP
   * allowlist, for instance, which will otherwise fail with an opaque error.
   */
  readonly caveats?: readonly string[];
  readonly credentialFields: readonly CredentialField[];
  /** True when the provider has a CDN proxy this integration must switch off. */
  readonly hasProxyToggle: boolean;
}

export interface DnsProvider extends DnsProviderMeta {
  /**
   * Validates raw form values. Throws `DnsProviderError` with code
   * `invalid_credentials` and a field-level message when they don't fit.
   */
  parseCredentials(raw: Record<string, string>): DnsCredentials;

  /** One cheap authenticated call. Throws on rejection. */
  verify(credentials: DnsCredentials): Promise<VerifiedCredentials>;

  listZones(credentials: DnsCredentials): Promise<DnsZone[]>;

  listRecords(credentials: DnsCredentials, zone: DnsZone): Promise<DnsRecord[]>;

  /**
   * Creates the record, or updates it in place when one already exists at that
   * name and type. Idempotent by contract: pressing the button twice, or
   * pressing it after the origin IP changed, must both end with the record
   * pointing at `value`.
   */
  upsertRecord(
    credentials: DnsCredentials,
    input: UpsertRecordInput,
  ): Promise<UpsertRecordResult>;
}
