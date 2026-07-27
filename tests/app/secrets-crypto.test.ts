import { describe, expect, it } from 'vitest';
import {
  SecretCryptoError,
  decryptSecret,
  encryptSecret,
  isCredentialEncryptionConfigured,
  secretsMatch,
} from '@/lib/crypto/secrets';

/**
 * The envelope protecting customers' DNS API tokens at rest.
 *
 * The property worth testing isn't "it round-trips" — any cipher does that.
 * It's that a *modified* ciphertext fails loudly instead of decrypting to
 * something. Without the GCM tag check, a database attacker could swap a
 * customer's token for their own and the app would go and create DNS records
 * with it.
 */

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a credential blob', () => {
    const plaintext = JSON.stringify({ apiToken: 'v1.0-abcdef', extra: 'ünïcodé' });
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });

  it('produces a different ciphertext every time', () => {
    // A fresh IV per message: identical tokens for two customers must not
    // produce identical rows.
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('is versioned and dot-delimited', () => {
    const parts = encryptSecret('x').split('.');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
  });

  it('rejects a tampered ciphertext', () => {
    const [version, iv, tag, data] = encryptSecret('secret-token').split('.') as [
      string,
      string,
      string,
      string,
    ];
    const flipped = data.startsWith('A') ? `B${data.slice(1)}` : `A${data.slice(1)}`;
    expect(() => decryptSecret([version, iv, tag, flipped].join('.'))).toThrow(
      SecretCryptoError,
    );
  });

  it('rejects a tampered auth tag', () => {
    const [version, iv, tag, data] = encryptSecret('secret-token').split('.') as [
      string,
      string,
      string,
      string,
    ];
    const flipped = tag.startsWith('A') ? `B${tag.slice(1)}` : `A${tag.slice(1)}`;
    expect(() => decryptSecret([version, iv, flipped, data].join('.'))).toThrow(
      SecretCryptoError,
    );
  });

  it('rejects a malformed or unknown-version envelope', () => {
    for (const value of ['', 'plain-text', 'v1.a.b', 'v2.a.b.c']) {
      expect(() => decryptSecret(value), value).toThrow(SecretCryptoError);
    }
  });
});

describe('isCredentialEncryptionConfigured', () => {
  it('is true when a valid key is present', () => {
    expect(isCredentialEncryptionConfigured()).toBe(true);
  });
});

describe('secretsMatch', () => {
  it('compares equal-length values', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true);
    expect(secretsMatch('abc', 'abd')).toBe(false);
  });

  it('returns false rather than throwing on a length mismatch', () => {
    // `timingSafeEqual` throws on differing lengths; callers pass user input.
    expect(secretsMatch('abc', 'abcd')).toBe(false);
  });
});
