import { z } from 'zod';

const uuidSchema = z.uuid();

/**
 * Guards a `uuid` column against a malformed id.
 *
 * Every route param and server-action id argument is an untrusted string that
 * ends up in a `where id = $1` against a Postgres `uuid` column. Postgres
 * doesn't return "no rows" for a bad shape — it *throws*
 * `invalid input syntax for type uuid`, which used to escape as an uncaught
 * 500. Checking the shape first turns those into the same "not found" a
 * well-formed but unknown id produces.
 */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && uuidSchema.safeParse(value).success;
}

/** Bytes of entropy behind `randomToken` — 128 bits, i.e. 32 hex characters. */
const TOKEN_BYTES = 16;

/**
 * A random, URL- and DNS-safe hex token from the platform CSPRNG.
 *
 * Used for the two per-site secrets in `db/schema.ts`: the public
 * `verificationToken` an owner publishes to prove they control a domain, and
 * the private `crawlSecret` the crawler presents on every request. `crypto`
 * is a global in both the Node and Edge runtimes, so this stays free of a
 * `node:crypto` import and the schema module remains portable.
 */
export function randomToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
