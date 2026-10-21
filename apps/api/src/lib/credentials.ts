import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from '../errors';

/**
 * Envelope encryption for third-party credentials (ADR-008): each record gets a random 256-bit
 * data key; the payload is sealed with it (AES-256-GCM) and the data key is sealed with the
 * master key. Rotating the master key re-wraps data keys without touching payloads.
 * Blob layout: iv (12) | tag (16) | ciphertext.
 */
export const CREDENTIALS_KEY_VERSION = 1;

export interface Sealed {
  keyVersion: number;
  wrappedKey: Buffer;
  ciphertext: Buffer;
}

function masterKey(b64: string | undefined): Buffer {
  if (!b64)
    throw new AppError(
      503,
      'credentials_unavailable',
      'Credentials store unavailable',
      'CREDENTIALS_MASTER_KEY is not configured.',
    );
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('CREDENTIALS_MASTER_KEY must be 32 bytes, base64-encoded');
  return key;
}

function seal(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function open(key: Buffer, blob: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

export function sealSecret<T extends object>(masterKeyB64: string | undefined, value: T): Sealed {
  const master = masterKey(masterKeyB64);
  const dataKey = randomBytes(32);
  return {
    keyVersion: CREDENTIALS_KEY_VERSION,
    wrappedKey: seal(master, dataKey),
    ciphertext: seal(dataKey, Buffer.from(JSON.stringify(value), 'utf8')),
  };
}

export function openSecret<T>(masterKeyB64: string | undefined, sealed: Sealed): T {
  const dataKey = open(masterKey(masterKeyB64), sealed.wrappedKey);
  return JSON.parse(open(dataKey, sealed.ciphertext).toString('utf8')) as T;
}
