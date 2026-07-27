import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Authenticated encryption for third-party credentials at rest.
 *
 * The only thing stored encrypted in this database is a customer's DNS
 * provider API token, and the threat it's protecting against is a database
 * disclosure — a leaked backup, a stray read replica, an over-broad support
 * query. That rules out anything reversible-by-inspection (base64, an
 * obfuscation helper) and it rules out plain AES-CBC too: a token that can be
 * tampered with is a token that can be swapped for an attacker's, and the app
 * would happily create DNS records with it.
 *
 * So: AES-256-GCM, a fresh 96-bit IV per message, and the auth tag stored
 * alongside. Decryption fails loudly rather than returning garbage.
 *
 * The stored format is a single string, versioned so a future key rotation or
 * algorithm change is a migration rather than a guess:
 *
 *     v1.<iv base64url>.<auth tag base64url>.<ciphertext base64url>
 *
 * Dots because base64url has no `.`, so splitting can't be ambiguous.
 */

const FORMAT_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
/** GCM's standard nonce size. Longer IVs get hashed and buy nothing. */
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * Thrown for every failure in this module. Callers surface a generic message:
 * the difference between "wrong key" and "tampered ciphertext" is useful to us
 * in logs and useful to an attacker in a response body.
 */
export class SecretCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretCryptoError';
  }
}

/**
 * The 32-byte key, decoded from `CREDENTIALS_ENCRYPTION_KEY`.
 *
 * Accepts base64 or hex so operators can paste whatever
 * `openssl rand -base64 32` or `openssl rand -hex 32` gave them. Resolved on
 * every call rather than cached at import: `lib/env.ts` is deliberately soft,
 * and a module-level throw here would take down routes that never touch DNS.
 */
function encryptionKey(): Buffer {
  const raw = env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new SecretCryptoError(
      'CREDENTIALS_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` ' +
        'and add it to .env.local — DNS credentials are never stored without it.',
    );
  }

  const decoded = decodeKey(raw.trim());
  if (decoded.length !== KEY_BYTES) {
    throw new SecretCryptoError(
      `CREDENTIALS_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${decoded.length}). ` +
        'Generate one with `openssl rand -base64 32`.',
    );
  }
  return decoded;
}

function decodeKey(raw: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return Buffer.from(raw, 'base64');
}

/** True when credentials can be stored at all. Gates the whole DNS feature. */
export function isCredentialEncryptionConfigured(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypts a UTF-8 string into the versioned envelope described above. */
export function encryptSecret(plaintext: string): string {
  const key = encryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    FORMAT_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Reverses `encryptSecret`. Throws `SecretCryptoError` for a malformed
 * envelope, the wrong key, or any tampering — GCM's tag check is what makes
 * the last one detectable rather than silent.
 */
export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4) {
    throw new SecretCryptoError('Malformed encrypted value');
  }
  const [version, ivPart, tagPart, dataPart] = parts as [string, string, string, string];
  if (version !== FORMAT_VERSION) {
    throw new SecretCryptoError(`Unsupported encrypted value version "${version}"`);
  }

  const key = encryptionKey();
  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== 16) {
    throw new SecretCryptoError('Malformed encrypted value');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new SecretCryptoError(
      'Could not decrypt stored credentials — the encryption key has changed, or the ' +
        'value was modified. Reconnect the provider to store a fresh credential.',
    );
  }
}

/**
 * Constant-time string comparison, for the rare place a secret is compared
 * rather than decrypted. `===` leaks the length of the matching prefix.
 */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
