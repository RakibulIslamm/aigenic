import 'server-only';
import { and, eq, notInArray } from 'drizzle-orm';
import { db } from '@/db';
import { dnsConnections, sites, type DnsConnection } from '@/db/schema';
import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets';
import { DnsProviderError } from '@/lib/dns/errors';
import type { DnsCredentials } from '@/lib/dns/types';

/**
 * Storage for DNS provider credentials.
 *
 * The single rule this module exists to enforce: **plaintext credentials never
 * leave it.** Callers hand in a credential map and get back a connection id;
 * they ask for credentials by id and get them for the duration of one provider
 * call. Nothing returns a `DnsConnection` with its `credentials` column
 * attached, so there is no accidental path from a database row to a server
 * component's props to the browser.
 */

/** What the UI is allowed to know about a connection. */
export interface DnsConnectionSummary {
  id: string;
  provider: string;
  label: string;
  lastVerifiedAt: Date | null;
}

export function toSummary(
  connection: Pick<DnsConnection, 'id' | 'provider' | 'label' | 'lastVerifiedAt'>,
): DnsConnectionSummary {
  return {
    id: connection.id,
    provider: connection.provider,
    label: connection.label,
    lastVerifiedAt: connection.lastVerifiedAt,
  };
}

/**
 * Stores a freshly verified credential and returns the new connection.
 *
 * A new row every time, rather than an upsert on (user, provider): a customer
 * can legitimately hold two Cloudflare accounts, and overwriting the first
 * would silently repoint an already-working site at credentials that can't see
 * its zone. The tidy-up afterwards deletes only rows nothing references, so
 * repeatedly re-entering a token doesn't accumulate junk either.
 */
export async function saveDnsConnection(params: {
  userId: string;
  provider: string;
  label: string;
  credentials: DnsCredentials;
}): Promise<DnsConnectionSummary> {
  const [row] = await db
    .insert(dnsConnections)
    .values({
      userId: params.userId,
      provider: params.provider,
      label: params.label,
      credentials: encryptSecret(JSON.stringify(params.credentials)),
      lastVerifiedAt: new Date(),
    })
    .returning();

  if (!row) {
    throw new DnsProviderError(
      'unavailable',
      'Could not save the connection. Try again.',
    );
  }

  await deleteUnusedConnections(params.userId, row.id);
  return toSummary(row);
}

/**
 * Decrypts one connection's credentials, scoped to its owner.
 *
 * `userId` is part of the lookup rather than checked afterwards — a
 * connection id is a uuid a browser sends us, and "load then compare" is one
 * forgotten comparison away from letting any signed-in user drive someone
 * else's DNS account.
 */
export async function loadDnsCredentials(
  connectionId: string,
  userId: string,
): Promise<{ provider: string; credentials: DnsCredentials }> {
  const connection = await db.query.dnsConnections.findFirst({
    where: and(eq(dnsConnections.id, connectionId), eq(dnsConnections.userId, userId)),
  });
  if (!connection) {
    throw new DnsProviderError(
      'not_found',
      'That DNS connection no longer exists. Connect your provider again.',
    );
  }

  const decoded: unknown = JSON.parse(decryptSecret(connection.credentials));
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new DnsProviderError(
      'invalid_credentials',
      'The stored credentials could not be read. Connect your provider again.',
    );
  }

  return {
    provider: connection.provider,
    credentials: decoded as DnsCredentials,
  };
}

export async function getDnsConnectionSummary(
  connectionId: string,
  userId: string,
): Promise<DnsConnectionSummary | null> {
  const row = await db.query.dnsConnections.findFirst({
    where: and(eq(dnsConnections.id, connectionId), eq(dnsConnections.userId, userId)),
    columns: { id: true, provider: true, label: true, lastVerifiedAt: true },
  });
  return row ? toSummary(row) : null;
}

/** Marks a connection as still working, after a successful provider call. */
export async function touchDnsConnection(connectionId: string): Promise<void> {
  await db
    .update(dnsConnections)
    .set({ lastVerifiedAt: new Date() })
    .where(eq(dnsConnections.id, connectionId));
}

/**
 * Forgets a connection. The site rows pointing at it clear via `ON DELETE SET
 * NULL`, but their `crawlHost` is cleared explicitly by the caller — a site
 * left with a crawl host and no connection would keep routing crawls through a
 * record we can no longer manage.
 */
export async function deleteDnsConnection(
  connectionId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(dnsConnections)
    .where(and(eq(dnsConnections.id, connectionId), eq(dnsConnections.userId, userId)));
}

/** Drops this user's connections that no site references, except `keepId`. */
async function deleteUnusedConnections(userId: string, keepId: string): Promise<void> {
  const inUse = await db
    .selectDistinct({ id: sites.dnsConnectionId })
    .from(sites)
    .where(eq(sites.userId, userId));

  const keep = [
    keepId,
    ...inUse.map((row) => row.id).filter((id): id is string => id !== null),
  ];

  await db
    .delete(dnsConnections)
    .where(and(eq(dnsConnections.userId, userId), notInArray(dnsConnections.id, keep)));
}

/** Every connection this user holds, for the picker's "reuse an existing" list. */
export async function listDnsConnections(
  userId: string,
): Promise<DnsConnectionSummary[]> {
  const rows = await db.query.dnsConnections.findMany({
    where: eq(dnsConnections.userId, userId),
    columns: { id: true, provider: true, label: true, lastVerifiedAt: true },
  });
  return rows.map(toSummary);
}
