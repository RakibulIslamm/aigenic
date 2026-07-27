import 'server-only';
import { DnsProviderError } from '@/lib/dns/errors';
import { cloudflareProvider } from '@/lib/dns/providers/cloudflare';
import { digitalOceanProvider } from '@/lib/dns/providers/digitalocean';
import { googleCloudDnsProvider } from '@/lib/dns/providers/google-clouddns';
import { namecheapProvider } from '@/lib/dns/providers/namecheap';
import { route53Provider } from '@/lib/dns/providers/route53';
import { isDnsProviderId, type DnsProvider, type DnsProviderId } from '@/lib/dns/types';

/**
 * Provider id → adapter. Server-only: importing this pulls in `node:crypto`
 * (Route 53's signer, Google's JWT) and every adapter's network code. The
 * browser gets `lib/dns/catalog.ts` instead.
 */
const PROVIDERS: Record<DnsProviderId, DnsProvider> = {
  cloudflare: cloudflareProvider,
  route53: route53Provider,
  digitalocean: digitalOceanProvider,
  namecheap: namecheapProvider,
  'google-clouddns': googleCloudDnsProvider,
};

/**
 * Resolves an adapter from a string that came off a form or out of the
 * database. Throws rather than returning undefined: every caller would have
 * had to invent the same error message.
 */
export function getDnsProvider(id: string): DnsProvider {
  if (!isDnsProviderId(id)) {
    throw new DnsProviderError('unsupported', `We don't support ${id} yet.`);
  }
  return PROVIDERS[id];
}
