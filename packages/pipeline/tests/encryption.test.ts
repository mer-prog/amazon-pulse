import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt } from '../src/lib/encryption.js';

beforeAll(() => {
  if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  }
});

describe('encryption', () => {
  it('round-trips a refresh token through encrypt/decrypt', () => {
    const plaintext = 'Atzr|Atzr|fake-refresh-token-for-unit-test';
    const ciphertext = encrypt(plaintext);
    expect(ciphertext.startsWith('v1:')).toBe(true);
    expect(ciphertext).not.toContain(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('produces a different ciphertext on each call (random IV)', () => {
    const plaintext = 'same-input';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it('rejects malformed ciphertext', () => {
    expect(() => decrypt('not-a-valid-payload')).toThrow();
    expect(() => decrypt('v2:aaa:bbb:ccc')).toThrow();
  });

  it('rejects ciphertext whose auth tag was tampered with', () => {
    const ct = encrypt('sensitive');
    const parts = ct.split(':');
    parts[2] = Buffer.from(new Uint8Array(16).fill(0)).toString('base64');
    expect(() => decrypt(parts.join(':'))).toThrow();
  });
});
