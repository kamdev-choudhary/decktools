import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Where s3deck keeps users, remembered connections, its secret key and the activity log. */
export function resolveDataDir(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  if (process.env.S3DECK_DATA_DIR) return path.resolve(process.env.S3DECK_DATA_DIR);
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 's3deck');
}

export async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

/** Writes via a temp file + rename, so a crash never leaves a half-written file. Owner-only permissions. */
export async function writeFileAtomic(file: string, data: string | Buffer) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, file);
  await chmod(file, 0o600).catch(() => {});
}

export function writeJsonAtomic(file: string, value: unknown) {
  return writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}
