import { describe, expect, it } from 'vitest';
import {
  connectionInputSchema,
  copySchema,
  createUserSchema,
  deleteSchema,
  formatZodError,
  newBucketNameSchema,
  objectKeySchema,
  presignSchema,
} from '../../src/shared/schemas';

describe('bucket names', () => {
  it.each(['my-bucket', 'logs.2024', 'abc', 'a1b2c3'])('accepts %s', (name) => {
    expect(newBucketNameSchema.safeParse(name).success).toBe(true);
  });

  it.each([
    ['ab', 'too short'],
    ['My-Bucket', 'uppercase'],
    ['-bucket', 'leading hyphen'],
    ['bucket-', 'trailing hyphen'],
    ['my..bucket', 'adjacent dots'],
    ['my.-bucket', 'dot next to hyphen'],
    ['192.168.1.1', 'looks like an IP'],
    ['a'.repeat(64), 'too long'],
  ])('rejects %s (%s)', (name) => {
    expect(newBucketNameSchema.safeParse(name).success).toBe(false);
  });
});

describe('object keys', () => {
  it('limits keys to 1,024 bytes, not characters', () => {
    expect(objectKeySchema.safeParse('a'.repeat(1024)).success).toBe(true);
    expect(objectKeySchema.safeParse('a'.repeat(1025)).success).toBe(false);
    // "é" is 2 bytes in UTF-8
    expect(objectKeySchema.safeParse('é'.repeat(513)).success).toBe(false);
  });

  it('rejects empty keys', () => {
    expect(objectKeySchema.safeParse('').success).toBe(false);
  });
});

describe('connection input', () => {
  const base = { accessKeyId: 'AKIA', secretAccessKey: 'secret' };

  it('accepts http(s) endpoints and an empty one (AWS)', () => {
    expect(connectionInputSchema.safeParse({ ...base, endpoint: 'http://localhost:9000' }).success).toBe(true);
    expect(connectionInputSchema.safeParse({ ...base, endpoint: '' }).success).toBe(true);
    expect(connectionInputSchema.safeParse(base).success).toBe(true);
  });

  it('rejects other schemes and URLs with credentials', () => {
    expect(connectionInputSchema.safeParse({ ...base, endpoint: 'ftp://host' }).success).toBe(false);
    expect(connectionInputSchema.safeParse({ ...base, endpoint: 'https://user:pw@host' }).success).toBe(false);
    expect(connectionInputSchema.safeParse({ ...base, endpoint: 'not a url' }).success).toBe(false);
  });

  it('requires both keys', () => {
    expect(connectionInputSchema.safeParse({ accessKeyId: 'x' }).success).toBe(false);
    expect(connectionInputSchema.safeParse({ secretAccessKey: 'x' }).success).toBe(false);
  });
});

describe('operations', () => {
  it('copy: folders must go to folders', () => {
    const ok = copySchema.safeParse({ destinationBucket: 'b', items: [{ source: 'a/', destination: 'b/' }] });
    const bad = copySchema.safeParse({ destinationBucket: 'b', items: [{ source: 'a/', destination: 'b.txt' }] });
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });

  it('delete: needs something to delete, and folders end with "/"', () => {
    expect(deleteSchema.safeParse({}).success).toBe(false);
    expect(deleteSchema.safeParse({ prefixes: ['folder'] }).success).toBe(false);
    expect(deleteSchema.safeParse({ prefixes: ['folder/'] }).success).toBe(true);
  });

  it('presign: expiry between 60 seconds and 7 days', () => {
    const p = (expiresIn: number) => presignSchema.safeParse({ key: 'k', method: 'GET', expiresIn }).success;
    expect(p(59)).toBe(false);
    expect(p(60)).toBe(true);
    expect(p(7 * 24 * 3600)).toBe(true);
    expect(p(7 * 24 * 3600 + 1)).toBe(false);
  });

  it('users: password length and valid roles', () => {
    expect(createUserSchema.safeParse({ username: 'ann', password: 'short', role: 'viewer' }).success).toBe(false);
    expect(createUserSchema.safeParse({ username: 'ann', password: 'long-enough-1', role: 'owner' }).success).toBe(
      false,
    );
    expect(createUserSchema.safeParse({ username: 'ann', password: 'long-enough-1', role: 'editor' }).success).toBe(
      true,
    );
  });
});

describe('formatZodError', () => {
  it('names the field', () => {
    const r = presignSchema.safeParse({ key: 'k', method: 'GET', expiresIn: 1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(formatZodError(r.error)).toMatch(/^expiresIn: /);
  });
});
