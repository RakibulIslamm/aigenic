import { describe, expect, it } from 'vitest';
import { isUuid } from '@/lib/ids';

/**
 * `isUuid` is the guard standing between a raw route param / server-action
 * argument and a Postgres `uuid` column. Postgres throws rather than
 * returning zero rows for a malformed value, so anything this lets through
 * that Postgres would reject is a 500.
 */
describe('isUuid', () => {
  it('accepts the ids the schema actually generates', () => {
    // `defaultRandom()` emits v4.
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isUuid('0d2b8f6e-1c3a-4f7b-9a1e-2c3d4e5f6a7b')).toBe(true);
  });

  it('rejects the shapes that used to crash the query', () => {
    expect(isUuid('site-1')).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    // Right length, wrong alphabet.
    expect(isUuid('zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz')).toBe(false);
    // Trailing junk — a substring match would have let this through.
    expect(isUuid('11111111-1111-4111-8111-111111111111x')).toBe(false);
  });

  it('rejects missing values without throwing', () => {
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
