import { describe, expect, it } from 'vitest';
import { copySource, publicObjectUrl } from '../../src/s3/client';
import { parseRestore } from '../../src/s3/objects';
import { detectProvider, refineProvider } from '../../src/s3/provider';
import { sameObject } from '../../src/s3/sync';
import { contentDisposition } from '../../src/server/routes/objects';

describe('provider detection', () => {
  it.each([
    [undefined, 'aws', false],
    ['https://s3.eu-west-1.amazonaws.com', 'aws', false],
    ['https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com', 'r2', true],
    ['https://s3.us-west-004.backblazeb2.com', 'b2', false],
    ['https://nyc3.digitaloceanspaces.com', 'spaces', false],
    ['https://s3.eu-central-1.wasabisys.com', 'wasabi', false],
    ['http://localhost:9000', 'other', true],
  ])('%s → %s (path-style %s)', (endpoint, id, pathStyle) => {
    const p = detectProvider(endpoint);
    expect(p.id).toBe(id);
    expect(p.pathStyle).toBe(pathStyle);
  });

  it('takes the region from the endpoint where providers encode it', () => {
    expect(detectProvider('https://s3.us-west-004.backblazeb2.com').defaultRegion).toBe('us-west-004');
    expect(detectProvider('https://nyc3.digitaloceanspaces.com').defaultRegion).toBe('nyc3');
    expect(detectProvider('https://x.r2.cloudflarestorage.com').defaultRegion).toBe('auto');
  });

  it('hides features R2 does not have', () => {
    const caps = detectProvider('https://x.r2.cloudflarestorage.com').capabilities;
    expect(caps.versioning).toBe(false);
    expect(caps.tagging).toBe(false);
    expect(caps.storageClasses).toEqual(['STANDARD', 'STANDARD_IA']);
  });

  it('recognises MinIO from its Server header', () => {
    const p = refineProvider(detectProvider('http://localhost:9000'), 'MinIO');
    expect(p.id).toBe('minio');
    expect(refineProvider(detectProvider('http://localhost:9000'), 'nginx').id).toBe('other');
  });
});

describe('URLs', () => {
  it('encodes each key segment for x-amz-copy-source', () => {
    expect(copySource('b', 'a dir/ü+x.txt')).toBe('b/a%20dir/%C3%BC%2Bx.txt');
    expect(copySource('b', 'k', 'v1')).toBe('b/k?versionId=v1');
  });

  it('builds public object URLs', () => {
    const base = { bucket: 'b', key: 'a/b c.txt', region: 'eu-west-1' };
    expect(publicObjectUrl({ ...base, forcePathStyle: false })).toBe('https://b.s3.eu-west-1.amazonaws.com/a/b%20c.txt');
    expect(publicObjectUrl({ ...base, region: 'us-east-1', forcePathStyle: false })).toBe('https://b.s3.amazonaws.com/a/b%20c.txt');
    expect(publicObjectUrl({ ...base, endpoint: 'http://localhost:9000', forcePathStyle: true })).toBe('http://localhost:9000/b/a/b%20c.txt');
    expect(publicObjectUrl({ ...base, forcePathStyle: false, publicUrlBase: 'https://cdn.example.com/' })).toBe(
      'https://cdn.example.com/a/b%20c.txt',
    );
  });

  it('has no public URL for R2 unless a public base (r2.dev or custom domain) is set', () => {
    const r2 = { bucket: 'b', key: 'a/b c.txt', region: 'auto', forcePathStyle: true, endpoint: 'https://acc.r2.cloudflarestorage.com', providerId: 'r2' };
    expect(publicObjectUrl(r2)).toBeNull();
    expect(publicObjectUrl({ ...r2, publicUrlBase: 'https://pub-123.r2.dev' })).toBe('https://pub-123.r2.dev/a/b%20c.txt');
  });

  it('Content-Disposition keeps UTF-8 names and an ASCII fallback', () => {
    expect(contentDisposition('attachment', 'résumé "v2".pdf')).toBe(
      `attachment; filename="r_sum_ _v2_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22v2%22.pdf`,
    );
  });
});

describe('archive restore header', () => {
  it('parses x-amz-restore', () => {
    expect(parseRestore(undefined)).toEqual({ restore: 'none', restoreExpiry: null });
    expect(parseRestore('ongoing-request="true"')).toEqual({ restore: 'in-progress', restoreExpiry: null });
    expect(parseRestore('ongoing-request="false", expiry-date="Fri, 21 Dec 2012 00:00:00 GMT"')).toEqual({
      restore: 'restored',
      restoreExpiry: '2012-12-21T00:00:00.000Z',
    });
  });
});

describe('sync comparison', () => {
  it('compares size, and single-part ETags when both have one', () => {
    expect(sameObject({ size: 1, etag: 'a' }, { size: 1, etag: 'a' })).toBe(true);
    expect(sameObject({ size: 1, etag: 'a' }, { size: 1, etag: 'b' })).toBe(false);
    expect(sameObject({ size: 1, etag: 'a' }, { size: 2, etag: 'a' })).toBe(false);
    // Multipart ETags differ between providers and part sizes, so only size counts.
    expect(sameObject({ size: 1, etag: 'a-2' }, { size: 1, etag: 'b' })).toBe(true);
    expect(sameObject({ size: 1, etag: null }, { size: 1, etag: 'b' })).toBe(true);
  });
});
