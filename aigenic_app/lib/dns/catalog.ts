import type { DnsProviderId, DnsProviderMeta } from '@/lib/dns/types';

/**
 * What each provider looks like on the connect form.
 *
 * Client-safe by construction: plain data, no imports beyond types. The
 * adapters in `providers/` spread these into themselves rather than restating
 * them, so the label a user reads and the label the server logs can't drift.
 */

export const DNS_PROVIDER_META: Record<DnsProviderId, DnsProviderMeta> = {
  cloudflare: {
    id: 'cloudflare',
    label: 'Cloudflare',
    docsUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    help:
      'Create an API token with Zone → Zone → Read and Zone → DNS → Edit permissions, ' +
      'scoped to the zone you want to connect.',
    caveats: [
      'Use an API token, not your Global API Key — a token can be scoped to one zone and revoked on its own.',
    ],
    hasProxyToggle: true,
    credentialFields: [
      {
        name: 'apiToken',
        label: 'API token',
        type: 'password',
        placeholder: 'v1.0-…',
        help: 'Cloudflare dashboard → My Profile → API Tokens → Create Token.',
      },
    ],
  },

  route53: {
    id: 'route53',
    label: 'Amazon Route 53',
    docsUrl:
      'https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/access-control-managing-permissions.html',
    help:
      'Create an IAM user with route53:ListHostedZones, route53:ListResourceRecordSets ' +
      'and route53:ChangeResourceRecordSets, then paste its access keys.',
    caveats: [
      'Route 53 has no proxy layer, so the record we create always resolves straight to your origin.',
    ],
    hasProxyToggle: false,
    credentialFields: [
      { name: 'accessKeyId', label: 'Access key ID', type: 'text', placeholder: 'AKIA…' },
      { name: 'secretAccessKey', label: 'Secret access key', type: 'password' },
      {
        name: 'sessionToken',
        label: 'Session token',
        type: 'password',
        optional: true,
        help: 'Only needed for temporary STS credentials.',
      },
    ],
  },

  digitalocean: {
    id: 'digitalocean',
    label: 'DigitalOcean',
    docsUrl: 'https://cloud.digitalocean.com/account/api/tokens',
    help: 'Create a personal access token with read and write scopes.',
    hasProxyToggle: false,
    credentialFields: [
      {
        name: 'apiToken',
        label: 'Personal access token',
        type: 'password',
        placeholder: 'dop_v1_…',
        help: 'DigitalOcean control panel → API → Generate New Token (read + write).',
      },
    ],
  },

  namecheap: {
    id: 'namecheap',
    label: 'Namecheap',
    docsUrl: 'https://www.namecheap.com/support/api/intro/',
    help:
      'Enable API access under Profile → Tools → Namecheap API Access, then paste your ' +
      'API user and key.',
    caveats: [
      'Namecheap only answers API calls from allowlisted IPv4 addresses — add our address to ' +
        'the allowlist in your Namecheap profile first, and enter the same address below.',
      'API access requires 20+ domains, a $50 balance, or $50 spent in the last two years.',
      'Only domains using Namecheap BasicDNS or PremiumDNS can be managed here.',
      'Namecheap has no add-one-record call, so we rewrite the whole zone. We re-send every ' +
        'existing record — but avoid editing DNS in the Namecheap dashboard while this runs.',
    ],
    hasProxyToggle: false,
    credentialFields: [
      {
        name: 'apiUser',
        label: 'API user',
        type: 'text',
        help: 'Usually your Namecheap username.',
      },
      { name: 'apiKey', label: 'API key', type: 'password' },
      {
        name: 'username',
        label: 'Account username',
        type: 'text',
        optional: true,
        help: 'Only if it differs from the API user.',
      },
      {
        name: 'clientIp',
        label: 'Allowlisted IPv4 address',
        type: 'text',
        placeholder: '203.0.113.10',
        help: 'The address you added to Namecheap’s API allowlist.',
      },
    ],
  },

  'google-clouddns': {
    id: 'google-clouddns',
    label: 'Google Cloud DNS',
    docsUrl: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
    help:
      'Create a service account with the DNS Administrator role, download its JSON key, ' +
      'and paste the whole file below.',
    caveats: ['The Cloud DNS API must be enabled on the project the key belongs to.'],
    hasProxyToggle: false,
    credentialFields: [
      {
        name: 'serviceAccountJson',
        label: 'Service account key (JSON)',
        type: 'textarea',
        placeholder: '{ "type": "service_account", … }',
        help: 'The whole downloaded key file. We store it encrypted and never show it again.',
      },
    ],
  },
};

/** Stable render order for the provider picker. */
export const DNS_PROVIDER_ORDER: readonly DnsProviderId[] = [
  'cloudflare',
  'route53',
  'digitalocean',
  'google-clouddns',
  'namecheap',
];

export const DNS_PROVIDER_LIST: readonly DnsProviderMeta[] = DNS_PROVIDER_ORDER.map(
  (id) => DNS_PROVIDER_META[id],
);

export function dnsProviderLabel(id: string): string {
  return (
    (DNS_PROVIDER_META as Record<string, DnsProviderMeta | undefined>)[id]?.label ?? id
  );
}
