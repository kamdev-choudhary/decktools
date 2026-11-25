import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { partSizeFor } from '../../web/src/lib/upload-queue';
import { RateLimiter } from '../../src/server/middleware/rate-limit';
import { loadSecretKey, seal, unseal } from '../../src/server/store/crypto';
import { SavedConnectionStore } from '../../src/server/store/saved-connections';
import { hashPassword, UserStore, verifyPassword } from '../../src/server/store/users';
import { ZipTokens } from '../../src/server/zip-tokens';

const tmp = () => mkdtemp(path.join(os.tmpdir(), 's3deck-test-'));

describe('encryption at rest', () => {
  it('round-trips and detects tampering', async () => {
    const key = await loadSecretKey(await tmp(), 'a passphrase');
    const sealed = seal(key, { secret: 'hunter2' });
    expect(JSON.stringify(sealed)).not.toContain('hunter2');
    expect(unseal(key, sealed)).toEqual({ secret: 'hunter2' });

    const tampered = { ...sealed, data: Buffer.from('x'.repeat(20)).toString('base64') };
    expect(() => unseal(key, tampered)).toThrow();
    const otherKey = await loadSecretKey(await tmp(), 'another passphrase');
    expect(() => unseal(otherKey, sealed)).toThrow();
  });

  it('generates one key file with owner-only permissions and reuses it', async () => {
    const dir = await tmp();
    const a = await loadSecretKey(dir, '');
    const b = await loadSecretKey(dir, '');
    expect(a.equals(b)).toBe(true);
    expect((await stat(path.join(dir, 'secret.key'))).mode & 0o777).toBe(0o600);
  });

  it('remembered connections are stored encrypted', async () => {
    const dir = await tmp();
    const key = await loadSecretKey(dir, 'pw');
    const store = new SavedConnectionStore(dir, key);
    await store.add({
      id: '1',
      owner: 'ann',
      endpoint: null,
      region: 'us-east-1',
      pathStyle: 'auto',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'very-secret-value',
      buckets: [],
      publicUrlBase: null,
      savedAt: new Date().toISOString(),
    });
    const raw = await readFile(path.join(dir, 'connections.enc'), 'utf8');
    expect(raw).not.toContain('very-secret-value');
    expect(raw).not.toContain('AKIAEXAMPLE');

    const reloaded = new SavedConnectionStore(dir, key);
    await reloaded.load();
    expect(reloaded.all()[0]?.secretAccessKey).toBe('very-secret-value');
  });
});

describe('users', () => {
  it('hashes passwords with scrypt and verifies them', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash).toMatch(/^scrypt\$/);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('anything', null)).toBe(false);
  });

  it('stores users case-insensitively and persists them', async () => {
    const dir = await tmp();
    const users = new UserStore(dir);
    await users.load();
    await users.create({ username: 'Ann', password: 'long-enough-1', role: 'editor' });
    expect(users.get('ann')?.role).toBe('editor');
    await users.update('ANN', { role: 'admin', disabled: true });

    const again = new UserStore(dir);
    await again.load();
    expect(again.get('ann')).toMatchObject({ username: 'Ann', role: 'admin', disabled: true });
    expect(await again.remove('ann')).toBe(true);
    expect(again.list()).toEqual([]);
  });
});

describe('rate limiter', () => {
  it('blocks after the limit and resets', () => {
    const rl = new RateLimiter(3, 60_000);
    for (let i = 0; i < 3; i++) {
      expect(rl.retryAfter('ip')).toBe(0);
      rl.hit('ip');
    }
    expect(rl.retryAfter('ip')).toBeGreaterThan(0);
    expect(rl.retryAfter('other')).toBe(0);
    rl.reset('ip');
    expect(rl.retryAfter('ip')).toBe(0);
  });
});

describe('zip tokens', () => {
  it('are single-use and bound to the session', () => {
    const tokens = new ZipTokens();
    const req = { sessionId: 's1', connectionId: 'c', bucket: 'b', base: '', keys: ['k'], prefixes: [], name: 'x.zip' };
    const t1 = tokens.create(req);
    expect(tokens.take(t1, 's2')).toBeNull(); // wrong session (and now consumed)
    const t2 = tokens.create(req);
    expect(tokens.take(t2, 's1')?.bucket).toBe('b');
    expect(tokens.take(t2, 's1')).toBeNull();
  });
});

describe('resumable upload part size', () => {
  it('is at least 8 MiB and keeps under 10,000 parts', () => {
    const MiB = 1024 * 1024;
    expect(partSizeFor(20 * MiB)).toBe(8 * MiB);
    const huge = 5 * 1024 * 1024 * MiB; // 5 TiB
    const size = partSizeFor(huge);
    expect(Math.ceil(huge / size)).toBeLessThanOrEqual(10_000);
    expect(size % MiB).toBe(0);
  });
});
