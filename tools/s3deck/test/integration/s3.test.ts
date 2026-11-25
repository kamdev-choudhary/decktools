import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, client, testApp } from '../helpers';

/**
 * End-to-end tests against a real S3-compatible server. Skipped unless configured:
 *   S3DECK_TEST_ENDPOINT=http://localhost:9000 S3DECK_TEST_ACCESS_KEY=… S3DECK_TEST_SECRET_KEY=… pnpm test
 */
const endpoint = process.env.S3DECK_TEST_ENDPOINT;
const accessKeyId = process.env.S3DECK_TEST_ACCESS_KEY ?? 'minioadmin';
const secretAccessKey = process.env.S3DECK_TEST_SECRET_KEY ?? 'minioadmin';

describe.skipIf(!endpoint)('against a real S3 endpoint', () => {
  const bucket = `s3deck-test-${randomBytes(4).toString('hex')}`;
  let c: ReturnType<typeof client>;

  beforeAll(async () => {
    const { app } = await testApp();
    c = client(app);
    await c.login(ADMIN.username, ADMIN.password);
    const conn = await c.post('/api/connections', { endpoint, accessKeyId, secretAccessKey });
    expect(conn.status).toBe(201);
    expect((await c.post('/api/buckets', { name: bucket })).status).toBe(201);
  });

  afterAll(async () => {
    await c?.del(`/api/buckets/${bucket}?force=1`);
  });

  it('uploads, lists, previews (range) and downloads', async () => {
    const up = await c.putRaw(`/api/buckets/${bucket}/upload?key=${encodeURIComponent('docs/hello world.txt')}`, 'hello');
    expect(up.status).toBe(201);

    const list = await c.get(`/api/buckets/${bucket}/objects?prefix=docs/`);
    expect(list.json.objects.map((o: { name: string }) => o.name)).toEqual(['hello world.txt']);

    const range = await c.get(`/api/buckets/${bucket}/download?key=${encodeURIComponent('docs/hello world.txt')}&inline=1`, { range: 'bytes=1-3' });
    expect(range.status).toBe(206);
    expect(range.json).toBe('ell');
    // Inline previews of non-allowlisted types are served as text, sandboxed.
    expect(range.headers.get('content-type')).toContain('text/plain');
    expect(range.headers.get('content-security-policy')).toContain('sandbox');
  });

  it('resumable multipart upload: parts survive and the result is byte-identical', async () => {
    const key = 'big/file.bin';
    const parts = [randomBytes(5 * 1024 * 1024), randomBytes(5 * 1024 * 1024), randomBytes(1234)];
    const { uploadId } = (await c.post(`/api/buckets/${bucket}/multipart`, { key })).json;

    const etags: { PartNumber: number; ETag: string }[] = [];
    for (const [i, body] of parts.entries()) {
      // Sent raw, like the browser does.
      const res = await c.putRaw(`/api/buckets/${bucket}/multipart/part?key=${key}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${i + 1}`, body);
      expect(res.status).toBe(200);
      etags.push({ PartNumber: i + 1, ETag: res.json.etag });
    }

    const listed = await c.get(`/api/buckets/${bucket}/multipart/parts?key=${key}&uploadId=${encodeURIComponent(uploadId)}`);
    expect(listed.json.parts).toHaveLength(3);

    expect((await c.post(`/api/buckets/${bucket}/multipart/complete`, { key, uploadId, parts: etags })).status).toBe(200);
    const details = await c.get(`/api/buckets/${bucket}/details?key=${key}`);
    expect(details.json.size).toBe(parts.reduce((a, p) => a + p.length, 0));
  });

  it('copies, renames and deletes folders', async () => {
    await c.putRaw(`/api/buckets/${bucket}/upload?key=src/a.txt`, 'a');
    await c.putRaw(`/api/buckets/${bucket}/upload?key=src/sub/b.txt`, 'b');
    const copied = await c.post(`/api/buckets/${bucket}/copy`, {
      destinationBucket: bucket,
      items: [{ source: 'src/', destination: 'dst/' }],
    });
    expect(copied.json.copied).toBe(2);

    const intoItself = await c.post(`/api/buckets/${bucket}/copy`, {
      destinationBucket: bucket,
      items: [{ source: 'src/', destination: 'src/inner/' }],
    });
    expect(intoItself.status).toBe(400);

    const summary = await c.post(`/api/buckets/${bucket}/summary`, { prefixes: ['dst/'] });
    expect(summary.json).toEqual({ objects: 2, bytes: 2 });

    const deleted = await c.post(`/api/buckets/${bucket}/delete`, { prefixes: ['dst/', 'src/'] });
    expect(deleted.json.deleted).toBe(4);
  });

  it('presigned download links work without s3deck', async () => {
    await c.putRaw(`/api/buckets/${bucket}/upload?key=shared.txt`, 'shared');
    const { url } = (await c.post(`/api/buckets/${bucket}/presign`, { key: 'shared.txt', method: 'GET', expiresIn: 300 })).json;
    expect(await (await fetch(url)).text()).toBe('shared');
  });

  it('compare and sync between two folders', async () => {
    await c.putRaw(`/api/buckets/${bucket}/upload?key=sync-a/1.txt`, 'one');
    await c.putRaw(`/api/buckets/${bucket}/upload?key=sync-a/2.txt`, 'two');
    const conn = (await c.get('/api/connections')).json.activeId;
    const loc = (prefix: string) => ({ connectionId: conn, bucket, prefix });

    const before = await c.post('/api/sync/compare', { source: loc('sync-a/'), target: loc('sync-b/') });
    expect(before.json.counts).toMatchObject({ missing: 2, same: 0 });

    const job = (await c.post('/api/sync', { source: loc('sync-a/'), target: loc('sync-b/'), mode: 'copy' })).json;
    for (let i = 0; i < 50; i++) {
      const j = (await c.get(`/api/jobs/${job.id}`)).json;
      if (j.status !== 'running') {
        expect(j.status).toBe('done');
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const after = await c.post('/api/sync/compare', { source: loc('sync-a/'), target: loc('sync-b/') });
    expect(after.json.counts).toMatchObject({ missing: 0, changed: 0, same: 2 });
  });
});
