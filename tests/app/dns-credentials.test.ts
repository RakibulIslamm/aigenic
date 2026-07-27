import { describe, expect, it } from 'vitest';
import { DnsProviderError } from '@/lib/dns/errors';
import { getDnsProvider } from '@/lib/dns/registry';
import { DNS_PROVIDER_LIST, DNS_PROVIDER_META } from '@/lib/dns/catalog';
import { DNS_PROVIDER_IDS } from '@/lib/dns/types';

/**
 * Credential parsing for every provider — the one part of an adapter that can
 * be exercised without a network. It matters because a typo caught here is a
 * field-level error on the form, while the same typo caught by the provider is
 * an opaque 401 several seconds later.
 *
 * This also pins the catalogue/adapter relationship: the form renders from
 * `catalog.ts` and the server parses with `registry.ts`, so a field that
 * exists in one and not the other is silently un-fillable.
 */

describe('provider catalogue', () => {
  it('covers every provider id exactly once', () => {
    expect(DNS_PROVIDER_LIST.map((p) => p.id).sort()).toEqual(
      [...DNS_PROVIDER_IDS].sort(),
    );
  });

  it('gives each adapter the same metadata the form renders', () => {
    for (const id of DNS_PROVIDER_IDS) {
      const provider = getDnsProvider(id);
      const meta = DNS_PROVIDER_META[id];
      expect(provider.label, id).toBe(meta.label);
      expect(provider.credentialFields, id).toEqual(meta.credentialFields);
    }
  });

  it('refuses an unknown provider id', () => {
    expect(() => getDnsProvider('route52')).toThrow(DnsProviderError);
  });
});

describe('cloudflare', () => {
  const provider = getDnsProvider('cloudflare');

  it('accepts a token', () => {
    expect(
      provider.parseCredentials({ apiToken: '  v1.0-abcdefghijklmnopqrst  ' }),
    ).toEqual({ apiToken: 'v1.0-abcdefghijklmnopqrst' });
  });

  it('rejects an obviously truncated token, naming the field', () => {
    try {
      provider.parseCredentials({ apiToken: 'short' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DnsProviderError);
      expect((err as DnsProviderError).code).toBe('invalid_credentials');
      expect((err as DnsProviderError).field).toBe('apiToken');
    }
  });
});

describe('route53', () => {
  const provider = getDnsProvider('route53');
  const valid = {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  };

  it('accepts an access key pair', () => {
    expect(provider.parseCredentials({ ...valid })).toEqual(valid);
  });

  it('keeps an optional session token but omits it when blank', () => {
    expect(provider.parseCredentials({ ...valid, sessionToken: 'tok' })).toEqual({
      ...valid,
      sessionToken: 'tok',
    });
    expect(provider.parseCredentials({ ...valid, sessionToken: '' })).toEqual(valid);
  });

  it('rejects a short secret', () => {
    expect(() =>
      provider.parseCredentials({ ...valid, secretAccessKey: 'nope' }),
    ).toThrow(DnsProviderError);
  });
});

describe('digitalocean', () => {
  const provider = getDnsProvider('digitalocean');

  it('accepts a personal access token', () => {
    expect(
      provider.parseCredentials({ apiToken: 'dop_v1_0123456789abcdef0123456789' }),
    ).toEqual({ apiToken: 'dop_v1_0123456789abcdef0123456789' });
  });

  it('rejects an empty token', () => {
    expect(() => provider.parseCredentials({ apiToken: '' })).toThrow(DnsProviderError);
  });
});

describe('namecheap', () => {
  const provider = getDnsProvider('namecheap');
  const valid = {
    apiUser: 'someone',
    apiKey: '0123456789abcdef',
    clientIp: '203.0.113.10',
  };

  it('defaults the account username to the API user', () => {
    expect(provider.parseCredentials({ ...valid })).toEqual({
      ...valid,
      username: 'someone',
    });
  });

  it('rejects a non-IPv4 client address', () => {
    // Namecheap's allowlist is IPv4-only, and sending anything else fails
    // with an error number rather than a message anyone can act on.
    for (const clientIp of ['2001:db8::1', 'example.com', '']) {
      try {
        provider.parseCredentials({ ...valid, clientIp });
        expect.unreachable(`should have rejected ${clientIp}`);
      } catch (err) {
        expect((err as DnsProviderError).field, clientIp).toBe('clientIp');
      }
    }
  });
});

describe('google cloud dns', () => {
  const provider = getDnsProvider('google-clouddns');
  const key = {
    type: 'service_account',
    project_id: 'my-project',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n',
    client_email: 'svc@my-project.iam.gserviceaccount.com',
  };

  it('stores the key file verbatim and lifts the project id out of it', () => {
    const json = JSON.stringify(key);
    expect(provider.parseCredentials({ serviceAccountJson: json })).toEqual({
      serviceAccountJson: json,
      projectId: 'my-project',
    });
  });

  it('rejects non-JSON with a message about the key file', () => {
    try {
      provider.parseCredentials({ serviceAccountJson: 'not json' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DnsProviderError).field).toBe('serviceAccountJson');
    }
  });

  it('rejects JSON missing the fields the token exchange needs', () => {
    const { private_key: _omitted, ...withoutKey } = key;
    expect(() =>
      provider.parseCredentials({ serviceAccountJson: JSON.stringify(withoutKey) }),
    ).toThrow(DnsProviderError);
  });
});
