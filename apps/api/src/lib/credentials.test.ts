import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { openSecret, sealSecret } from './credentials';

const key = randomBytes(32).toString('base64');

it('round-trips, never stores plaintext, and fails on tampering or the wrong key', () => {
  const secret = { consumerKey: 'ck-123', consumerSecret: 'cs-456', passkey: 'pk-789' };
  const sealed = sealSecret(key, secret);
  expect(sealed.ciphertext.toString('utf8')).not.toContain('cs-456');
  expect(openSecret(key, sealed)).toEqual(secret);

  const other = sealSecret(key, secret);
  expect(other.ciphertext.equals(sealed.ciphertext)).toBe(false); // fresh data key + IV each time

  const tampered = { ...sealed, ciphertext: Buffer.from(sealed.ciphertext) };
  tampered.ciphertext[tampered.ciphertext.length - 1]! ^= 1;
  expect(() => openSecret(key, tampered)).toThrow();
  expect(() => openSecret(randomBytes(32).toString('base64'), sealed)).toThrow();
  expect(() => sealSecret(undefined, secret)).toThrow(/CREDENTIALS_MASTER_KEY/);
  expect(() => sealSecret(Buffer.from('short').toString('base64'), secret)).toThrow(/32 bytes/);
});
