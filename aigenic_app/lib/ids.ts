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
