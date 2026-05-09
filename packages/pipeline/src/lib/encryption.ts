/**
 * AES-256-GCM encryption for SP-API refresh tokens stored at rest.
 *
 * ─── Key generation ──────────────────────────────────────────────────────
 * The ENCRYPTION_KEY env var must hold a base64-encoded 32-byte (256-bit)
 * random key. Generate one locally with:
 *
 *     openssl rand -base64 32
 *
 * Then put the resulting string in your `.env.local`:
 *
 *     ENCRYPTION_KEY=YOUR_GENERATED_KEY_HERE
 *
 * For the Cloudflare Worker deployment, set it as a secret instead:
 *
 *     wrangler secret put ENCRYPTION_KEY
 *
 * NEVER commit a real key to source control. Rotating keys is supported via
 * the `v<n>:` prefix on each ciphertext, mirrored by
 * `sellers.encryption_key_version` in the database.
 *
 * ─── Wire format ────────────────────────────────────────────────────────
 *     v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const KEY_VERSION = 'v1';

function loadKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY env var is required (run: openssl rand -base64 32)');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
        'Re-generate with: openssl rand -base64 32',
    );
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    KEY_VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decrypt(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4) {
    throw new Error('Unsupported ciphertext format (expected 4 colon-separated segments)');
  }
  const [version, ivB64, tagB64, ctB64] = parts;
  if (version !== KEY_VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error(`Unsupported ciphertext version (expected ${KEY_VERSION})`);
  }
  const key = loadKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
