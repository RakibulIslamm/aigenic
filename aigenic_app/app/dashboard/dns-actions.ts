'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { sites, type Site } from '@/db/schema';
import { requireUserId } from '@/lib/auth/user';
import { isCredentialEncryptionConfigured } from '@/lib/crypto/secrets';
import {
  deleteDnsConnection,
  loadDnsCredentials,
  saveDnsConnection,
  touchDnsConnection,
} from '@/lib/dns/connections';
import { DnsProviderError, describeDnsError } from '@/lib/dns/errors';
import { detectOrigin, zoneCoversHost } from '@/lib/dns/origin';
import { getDnsProvider } from '@/lib/dns/registry';
import type { DnsZone } from '@/lib/dns/types';
import { isUuid } from '@/lib/ids';
import { log } from '@/lib/log';
import { consumeRateLimit } from '@/lib/ratelimit';
import { crawlHostFor, hostnameOf, pickZoneForHost } from '@/lib/sites/domains';
import { getSiteForUser } from '@/lib/sites/queries';

/**
 * Server actions behind "connect your DNS provider".
 *
 * The feature is one button from the customer's side, but it is three distinct
 * trust boundaries on ours, and they're kept as three actions on purpose:
 *
 *  1. **Connect** — credentials arrive, are proven against the provider, and
 *     are stored encrypted. Nothing is written to their DNS.
 *  2. **Enable** — a zone is chosen, its origin is read, and exactly one
 *     record is created. This is the only action that writes to a customer's
 *     zone, and every input it trusts is re-derived from the provider rather
 *     than taken from the form.
 *  3. **Disconnect** — we forget the credentials and stop routing crawls.
 *
 * The zone *name* is never taken from the browser. The form sends a zone id;
 * this file re-lists the account's zones and matches on it, so a crafted
 * request can't name a zone the connected account doesn't hold, and can't
 * claim `example.com`'s zone while the site is `attacker.test`.
 */

/** Short TTL: the record should follow an origin change within minutes. */
const CRAWL_RECORD_TTL_SECONDS = 300;

export interface DnsZoneOption {
  id: string;
  name: string;
}

export type DnsActionState =
  | {
      ok: true;
      message: string;
      connectionId?: string;
      zones?: DnsZoneOption[];
      /** Zone whose name contains the site's host, when exactly one does. */
      suggestedZoneId?: string | null;
    }
  | { ok: false; error: string; field?: string };

/**
 * Step 1: prove the credentials work, store them, and hand back the zones.
 *
 * Verification and zone listing happen in the same request because a token
 * that authenticates but can't list zones is useless for this feature, and
 * discovering that one screen later reads as a bug.
 */
export async function connectDnsProviderAction(
  siteId: string,
  _prevState: DnsActionState | undefined,
  formData: FormData,
): Promise<DnsActionState> {
  const userId = await requireUserId();

  const site = await loadOwnedSite(siteId, userId);
  if (!site) return { ok: false, error: 'Site not found' };

  if (!isCredentialEncryptionConfigured()) {
    return {
      ok: false,
      error:
        'Credential encryption is not configured on this deployment, so we will not store ' +
        'DNS API keys. Set CREDENTIALS_ENCRYPTION_KEY and try again.',
    };
  }

  const limited = await rateLimit(site.id);
  if (limited) return limited;

  const providerId = String(formData.get('provider') ?? '');

  try {
    const provider = getDnsProvider(providerId);
    const raw: Record<string, string> = {};
    for (const field of provider.credentialFields) {
      const value = formData.get(field.name);
      if (typeof value === 'string') raw[field.name] = value;
    }

    const credentials = provider.parseCredentials(raw);
    const verified = await provider.verify(credentials);
    const zones = await provider.listZones(credentials);

    if (zones.length === 0) {
      return {
        ok: false,
        error: `We connected to ${provider.label}, but that account holds no zones we can manage.`,
      };
    }

    const connection = await saveDnsConnection({
      userId,
      provider: provider.id,
      label: verified.label,
      credentials,
    });

    const host = hostnameOf(site.domain);
    const suggested = pickZoneForHost(zones, host);

    revalidatePath(`/dashboard/sites/${site.id}/settings`);
    return {
      ok: true,
      message: `Connected to ${provider.label}.`,
      connectionId: connection.id,
      zones: zones.map((zone) => ({ id: zone.id, name: zone.name })),
      suggestedZoneId: suggested?.id ?? null,
    };
  } catch (err) {
    return failure(err, 'connect dns provider', { siteId: site.id, providerId });
  }
}

/**
 * Step 2: read the zone, find the origin, and create `crawl.<domain>`.
 *
 * Everything that decides *what* gets written comes from the provider on this
 * request — the zone (re-listed and matched by id), the origin address (read
 * from the zone's own records) and the record name (derived from the stored
 * site domain). The form contributes only which zone to look at.
 */
export async function enableCrawlHostAction(
  siteId: string,
  connectionId: string,
  zoneId: string,
): Promise<DnsActionState> {
  const userId = await requireUserId();

  const site = await loadOwnedSite(siteId, userId);
  if (!site) return { ok: false, error: 'Site not found' };
  if (!isUuid(connectionId)) {
    return { ok: false, error: 'That DNS connection no longer exists.' };
  }

  const limited = await rateLimit(site.id);
  if (limited) return limited;

  const siteHost = hostnameOf(site.domain);
  const crawlHost = crawlHostFor(site.domain);

  try {
    const { provider: providerId, credentials } = await loadDnsCredentials(
      connectionId,
      userId,
    );
    const provider = getDnsProvider(providerId);

    // Re-listing rather than trusting the posted zone: this is what makes the
    // zone id a *selection* from the connected account instead of an arbitrary
    // identifier the browser gets to name.
    const zones = await provider.listZones(credentials);
    const zone = zones.find((candidate) => candidate.id === zoneId);
    if (!zone) {
      return {
        ok: false,
        error: 'That zone is no longer in the connected account. Reload and pick again.',
      };
    }

    if (!zoneCoversHost(zone.name, siteHost)) {
      return {
        ok: false,
        error: `${siteHost} isn't inside the ${zone.name} zone. Pick the zone that serves this site.`,
      };
    }

    const records = await provider.listRecords(credentials, zone);
    const detection = detectOrigin({
      records,
      siteHost,
      zoneName: zone.name,
      excludeName: crawlHost,
    });
    if (!detection.ok) {
      return { ok: false, error: detection.message };
    }

    const { address, type } = detection.origin;
    const result = await provider.upsertRecord(credentials, {
      zone,
      name: crawlHost,
      type,
      value: address,
      ttl: CRAWL_RECORD_TTL_SECONDS,
    });

    await db
      .update(sites)
      .set({
        dnsConnectionId: connectionId,
        dnsZoneId: zone.id,
        dnsZoneName: zone.name,
        crawlHost,
        crawlOriginIp: address,
        crawlRecordId: result.recordId,
        crawlHostCreatedAt: new Date(),
      })
      .where(and(eq(sites.id, site.id), eq(sites.userId, userId)));

    await touchDnsConnection(connectionId);

    log.info('crawl host configured', {
      siteId: site.id,
      provider: provider.id,
      crawlHost,
      updated: result.updated,
    });

    revalidatePath(`/dashboard/sites/${site.id}`, 'layout');
    return {
      ok: true,
      message: result.updated
        ? `${crawlHost} now points at ${address}.`
        : `Created ${crawlHost} → ${address}. DNS usually propagates within a few minutes.`,
    };
  } catch (err) {
    return failure(err, 'create crawl record', { siteId: site.id, crawlHost });
  }
}

/**
 * Re-runs origin detection against the zone already chosen.
 *
 * The origin moves — a server migration, a new load balancer — and the crawl
 * record silently keeps pointing at the old address. This is the "my crawls
 * started failing again" button.
 */
export async function refreshCrawlHostAction(siteId: string): Promise<DnsActionState> {
  const userId = await requireUserId();

  const site = await loadOwnedSite(siteId, userId);
  if (!site) return { ok: false, error: 'Site not found' };
  if (!site.dnsConnectionId || !site.dnsZoneId) {
    return { ok: false, error: 'Connect a DNS provider for this site first.' };
  }

  return enableCrawlHostAction(siteId, site.dnsConnectionId, site.dnsZoneId);
}

/**
 * Forgets the credentials and stops routing this site's crawls.
 *
 * The DNS record itself is deliberately left in place. Deleting records is not
 * a capability this integration has anywhere else, and a failed delete
 * half-way through disconnect would leave the customer worse off than an
 * orphan `crawl.` record they can remove in ten seconds at their provider.
 */
export async function disconnectDnsAction(siteId: string): Promise<DnsActionState> {
  const userId = await requireUserId();

  const site = await loadOwnedSite(siteId, userId);
  if (!site) return { ok: false, error: 'Site not found' };

  const crawlHost = site.crawlHost;

  await db
    .update(sites)
    .set({
      dnsConnectionId: null,
      dnsZoneId: null,
      dnsZoneName: null,
      crawlHost: null,
      crawlOriginIp: null,
      crawlRecordId: null,
      crawlHostCreatedAt: null,
    })
    .where(and(eq(sites.id, site.id), eq(sites.userId, userId)));

  if (site.dnsConnectionId) {
    // Only if no other site still uses it — `deleteDnsConnection` is scoped to
    // the user, and another site pointing at the same connection would lose
    // its credentials too.
    const stillUsed = await db.query.sites.findFirst({
      where: and(
        eq(sites.userId, userId),
        eq(sites.dnsConnectionId, site.dnsConnectionId),
      ),
      columns: { id: true },
    });
    if (!stillUsed) {
      await deleteDnsConnection(site.dnsConnectionId, userId);
    }
  }

  revalidatePath(`/dashboard/sites/${site.id}`, 'layout');
  return {
    ok: true,
    message: crawlHost
      ? `Disconnected. Crawls go back to ${hostnameOf(site.domain)}; you can delete the ${crawlHost} record at your provider.`
      : 'Disconnected.',
  };
}

/**
 * Re-lists the zones for a site's existing connection, so the picker can be
 * reopened without re-entering credentials.
 */
export async function listZonesAction(
  siteId: string,
  connectionId: string,
): Promise<DnsActionState> {
  const userId = await requireUserId();

  const site = await loadOwnedSite(siteId, userId);
  if (!site) return { ok: false, error: 'Site not found' };
  if (!isUuid(connectionId)) {
    return { ok: false, error: 'That DNS connection no longer exists.' };
  }

  const limited = await rateLimit(site.id);
  if (limited) return limited;

  try {
    const { provider: providerId, credentials } = await loadDnsCredentials(
      connectionId,
      userId,
    );
    const provider = getDnsProvider(providerId);
    const zones: DnsZone[] = await provider.listZones(credentials);
    const suggested = pickZoneForHost(zones, hostnameOf(site.domain));

    return {
      ok: true,
      message: `Found ${zones.length} zone${zones.length === 1 ? '' : 's'}.`,
      connectionId,
      zones: zones.map((zone) => ({ id: zone.id, name: zone.name })),
      suggestedZoneId: suggested?.id ?? null,
    };
  } catch (err) {
    return failure(err, 'list dns zones', { siteId: site.id });
  }
}

async function loadOwnedSite(siteId: string, userId: string): Promise<Site | null> {
  if (!isUuid(siteId)) return null;
  return (await getSiteForUser(siteId, userId)) ?? null;
}

/**
 * Every action here spends a third-party API call, and several of them cost
 * the *customer's* provider quota (Namecheap allows 50 a minute across the
 * whole key). A held-down button must not be able to burn that.
 */
async function rateLimit(siteId: string): Promise<DnsActionState | null> {
  const limit = await consumeRateLimit({
    key: `dns:site:10m:${siteId}`,
    limit: 15,
    windowSeconds: 600,
  });
  if (limit.ok) return null;
  return {
    ok: false,
    error: `Too many DNS requests. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`,
  };
}

/** Logs the real cause, returns the sentence the customer should read. */
function failure(
  err: unknown,
  what: string,
  context: Record<string, unknown>,
): DnsActionState {
  if (err instanceof DnsProviderError) {
    log.warn(`dns: could not ${what}`, { ...context, code: err.code });
    return { ok: false, error: err.message, ...(err.field ? { field: err.field } : {}) };
  }
  log.error(`dns: could not ${what}`, { ...context, err });
  return { ok: false, error: describeDnsError(err) };
}
