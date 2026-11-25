import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Role } from '../../shared/types';
import { readJson, writeJsonAtomic } from './files';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface UserRecord {
  username: string;
  /** "scrypt$<salt b64>$<hash b64>", or null for single-sign-on-only users. */
  passwordHash: string | null;
  role: Role;
  disabled: boolean;
  createdAt: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Users kept in <data-dir>/users.json. Usernames are case-insensitive. */
export class UserStore {
  private users = new Map<string, UserRecord>();
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'users.json');
  }

  async load() {
    const list = await readJson<UserRecord[]>(this.file, []);
    this.users = new Map(list.map((u) => [u.username.toLowerCase(), u]));
  }

  private persist() {
    return writeJsonAtomic(this.file, [...this.users.values()]);
  }

  list(): UserRecord[] {
    return [...this.users.values()].sort((a, b) => a.username.localeCompare(b.username));
  }

  get(username: string): UserRecord | undefined {
    return this.users.get(username.toLowerCase());
  }

  async create(input: { username: string; password?: string; role: Role }): Promise<UserRecord> {
    const record: UserRecord = {
      username: input.username,
      passwordHash: input.password ? await hashPassword(input.password) : null,
      role: input.role,
      disabled: false,
      createdAt: new Date().toISOString(),
    };
    this.users.set(input.username.toLowerCase(), record);
    await this.persist();
    return record;
  }

  async update(username: string, patch: { role?: Role; disabled?: boolean; password?: string }): Promise<UserRecord | undefined> {
    const u = this.get(username);
    if (!u) return undefined;
    if (patch.role) u.role = patch.role;
    if (patch.disabled !== undefined) u.disabled = patch.disabled;
    if (patch.password) u.passwordHash = await hashPassword(patch.password);
    await this.persist();
    return u;
  }

  async remove(username: string): Promise<boolean> {
    const ok = this.users.delete(username.toLowerCase());
    if (ok) await this.persist();
    return ok;
  }
}
