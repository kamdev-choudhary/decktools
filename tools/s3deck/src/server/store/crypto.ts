import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from './files';

const ALGO = 'aes-256-gcm';

/**
 * The key that encrypts data at rest. From S3DECK_SECRET if set (derived with scrypt),
 * otherwise a random key generated once and kept in <data-dir>/secret.key (mode 0600).
 */
export async function loadSecretKey(dataDir: string, secret = process.env.S3DECK_SECRET): Promise<Buffer> {
  if (secret) return scryptSync(secret, 's3deck-at-rest-v1', 32);
  const file = path.join(dataDir, 'secret.key');
  try {
    const key = Buffer.from((await readFile(file, 'utf8')).trim(), 'base64');
    if (key.length === 32) return key;
    throw new Error(`${file} is not a valid key`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    const key = randomBytes(32);
    await writeFileAtomic(file, `${key.toString('base64')}\n`);
    return key;
  }
}

export interface Sealed {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

export function seal(key: Buffer, value: unknown): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function unseal<T>(key: Buffer, sealed: Sealed): T {
  const decipher = createDecipheriv(ALGO, key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as T;
}
