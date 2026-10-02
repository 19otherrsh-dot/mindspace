import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { config } from '../config.ts';

/**
 * Mood notes are self-reported health data, which PRD §5.2 requires to be
 * encrypted at rest. They are sealed here with AES-256-GCM before insert and
 * opened on read, so a database dump alone reveals nothing.
 *
 * Layout: [12-byte IV][16-byte auth tag][ciphertext]
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function key(): Buffer {
  const buf = Buffer.from(config.moodEncryptionKey, 'hex');
  if (buf.length !== 32) {
    throw new Error('MOOD_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  return buf;
}

export function encryptNote(plaintext: string | null | undefined): Buffer | null {
  if (!plaintext) return null;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptNote(sealed: Buffer | null | undefined): string | null {
  if (!sealed || sealed.length <= IV_LENGTH + TAG_LENGTH) return null;
  try {
    const iv = sealed.subarray(0, IV_LENGTH);
    const tag = sealed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = sealed.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // A rotated or wrong key must not take down the whole stats screen.
    return null;
  }
}

/** Refresh tokens are stored as digests so a database leak cannot mint sessions. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
