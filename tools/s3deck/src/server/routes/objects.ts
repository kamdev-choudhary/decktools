import { Readable } from 'node:stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Hono } from 'hono';
import mime from 'mime-types';
import { z } from 'zod';
import { publicObjectUrl } from '../../s3/client';
import { listPage, summarize } from '../../s3/listing';
import {
  abortMultipart,
  completeMultipart,
  createMultipart,
  listIncomplete,
  listParts,
  uploadPart,
} from '../../s3/multipart';
import {
  changeStorageClass,
  createFolder,
  deleteVersion,
  getTags,
  headersOf,
  headObject,
  listDeleted,
  listVersions,
  objectExtras,
  presign,
  restoreArchived,
  restoreVersion,
  setTags,
  updateMetadata,
} from '../../s3/objects';
import { copyItems, deleteItems, mapLimit, uploadStream } from '../../s3/transfers';
import {
  bucketParamSchema,
  copySchema,
  createFolderSchema,
  deleteSchema,
  deletedQuerySchema,
  downloadQuerySchema,
  MAX_PART_BYTES,
  multipartCompleteSchema,
  multipartCreateSchema,
  multipartPartQuerySchema,
  multipartRefSchema,
  restoreArchiveSchema,
  storageClassSchema,
  keyQuerySchema,
  listQuerySchema,
  metadataSchema,
  objectKeySchema,
  presignSchema,
  summarySchema,
  tagsSchema,
  uploadQuerySchema,
  versionActionSchema,
  zipSchema,
} from '../../shared/schemas';
import type { ObjectDetails } from '../../shared/types';
import type { AuthedEnv, ServerContext } from '../context';
import { HttpError } from '../errors';
import { describeKeys, logActivity, writable } from '../middleware';
import { validate } from '../validate';

const bucketParam = z.object({ bucket: bucketParamSchema });

/** Types the browser may render inline. Everything else is shown as text or downloaded. */
const INLINE_SAFE = /^(image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf|text\/plain)$/i;

/** RFC 6266 Content-Disposition with a UTF-8 filename. */
export function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function fileName(key: string): string {
  return key.split('/').filter(Boolean).pop() ?? 'download';
}

export function objectRoutes(ctx: ServerContext) {
  const write = writable(ctx);

  return new Hono<AuthedEnv>()
    .get('/:bucket/objects', validate('param', bucketParam), validate('query', listQuerySchema), async (c) => {
      const conn = c.get('conn');
      const q = c.req.valid('query');
      const page = await listPage(conn.handle.client, c.req.valid('param').bucket, {
        prefix: q.prefix,
        cursor: q.cursor,
        flat: q.flat === '1',
        limit: q.limit,
      });
      return c.json(page);
    })

    .get('/:bucket/details', validate('param', bucketParam), validate('query', keyQuerySchema), async (c) => {
      const conn = c.get('conn');
      const { bucket } = c.req.valid('param');
      const { key, versionId } = c.req.valid('query');
      const h = await headObject(conn.handle.client, bucket, key, versionId);
      const body: ObjectDetails = {
        key,
        size: h.ContentLength ?? 0,
        etag: h.ETag ?? null,
        lastModified: h.LastModified?.toISOString() ?? null,
        storageClass: h.StorageClass ?? 'STANDARD',
        versionId: h.VersionId ?? null,
        contentType: h.ContentType ?? null,
        cacheControl: h.CacheControl ?? null,
        contentDisposition: h.ContentDisposition ?? null,
        contentEncoding: h.ContentEncoding ?? null,
        metadata: h.Metadata ?? {},
        headers: headersOf(h),
        publicUrl: publicObjectUrl({
          bucket,
          key,
          endpoint: conn.endpoint,
          region: conn.region,
          forcePathStyle: conn.handle.forcePathStyle,
          publicUrlBase: conn.publicUrlBase,
          providerId: conn.provider.id,
        }),
        ...(await objectExtras(conn.handle.client, bucket, key, h, { objectLock: conn.provider.capabilities.objectLock })),
      };
      return c.json(body);
    })

    /** Streams an object from storage. Supports Range (video seeking, partial previews). */
    .get('/:bucket/download', validate('param', bucketParam), validate('query', downloadQuerySchema), async (c) => {
      const conn = c.get('conn');
      const { bucket } = c.req.valid('param');
      const { key, versionId, inline } = c.req.valid('query');
      const range = c.req.header('range');
      if (range && !/^bytes=\d*-\d*$/.test(range)) throw new HttpError(416, 'BAD_RANGE', 'Unsupported Range header');

      const out = await conn.handle.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId, Range: range }),
        { abortSignal: c.req.raw.signal },
      );

      const name = fileName(key);
      const storedType = (out.ContentType || mime.lookup(name) || 'application/octet-stream').toLowerCase();
      const baseType = storedType.split(';')[0]?.trim() ?? '';
      const isInline = inline === '1';
      const safe = INLINE_SAFE.test(baseType);
      // Anything not on the safe list (HTML, SVG, XML, JS…) is served as plain text when previewed,
      // so a file in a bucket can never run script in s3deck's origin.
      const contentType = isInline && !safe ? 'text/plain; charset=utf-8' : storedType;

      const headers = new Headers({
        'Content-Type': contentType,
        'Content-Disposition': contentDisposition(isInline ? 'inline' : 'attachment', name),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        'Accept-Ranges': 'bytes',
      });
      if (baseType !== 'application/pdf') {
        headers.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
      }
      if (out.ContentLength !== undefined) headers.set('Content-Length', String(out.ContentLength));
      if (out.ContentRange) headers.set('Content-Range', out.ContentRange);
      if (out.ETag) headers.set('ETag', out.ETag);
      if (out.LastModified) headers.set('Last-Modified', out.LastModified.toUTCString());
      if (out.ContentEncoding && isInline) headers.set('Content-Encoding', out.ContentEncoding);

      const body = out.Body?.transformToWebStream() ?? null;
      return new Response(body, { status: out.ContentRange ? 206 : 200, headers });
    })

    /** Streams the request body to storage (multipart for large files). No bucket CORS needed. */
    .put('/:bucket/upload', write, validate('param', bucketParam), validate('query', uploadQuerySchema), async (c) => {
      const conn = c.get('conn');
      const { bucket } = c.req.valid('param');
      const { key, contentType } = c.req.valid('query');
      if (key.endsWith('/')) throw new HttpError(400, 'VALIDATION', 'File keys must not end with "/"');
      const raw = c.req.raw.body;
      if (!raw) throw new HttpError(400, 'VALIDATION', 'Missing request body');

      const type = contentType || c.req.header('content-type') || mime.lookup(key) || 'application/octet-stream';
      const body = Readable.fromWeb(raw as import('node:stream/web').ReadableStream<Uint8Array>);
      const { etag } = await uploadStream(conn.handle.client, {
        bucket,
        key,
        body,
        contentType: type,
        signal: c.req.raw.signal,
      });
      logActivity(ctx, c, 'object.upload', { bucket, detail: key });
      return c.json({ key, etag }, 201);
    })

    .post('/:bucket/folder', write, validate('param', bucketParam), validate('json', createFolderSchema), async (c) => {
      const conn = c.get('conn');
      await createFolder(conn.handle.client, c.req.valid('param').bucket, c.req.valid('json').prefix);
      logActivity(ctx, c, 'folder.create', { bucket: c.req.valid('param').bucket, detail: c.req.valid('json').prefix });
      return c.json({ ok: true }, 201);
    })

    /** Counts what's under folders, e.g. before deleting them. */
    .post('/:bucket/summary', validate('param', bucketParam), validate('json', summarySchema), async (c) => {
      const conn = c.get('conn');
      const { bucket } = c.req.valid('param');
      const { keys, prefixes } = c.req.valid('json');
      const sizes = new Map<string, number>();
      await mapLimit(keys, 8, async (key) => {
        const h = await headObject(conn.handle.client, bucket, key);
        sizes.set(key, h.ContentLength ?? 0);
      });
      return c.json(await summarize(conn.handle.client, bucket, prefixes, sizes, c.req.raw.signal));
    })

    .post('/:bucket/delete', write, validate('param', bucketParam), validate('json', deleteSchema), async (c) => {
      const conn = c.get('conn');
      const input = c.req.valid('json');
      const result = await deleteItems(conn.handle.client, c.req.valid('param').bucket, input);
      logActivity(ctx, c, 'object.delete', {
        bucket: c.req.valid('param').bucket,
        detail: `${describeKeys([...input.prefixes, ...input.keys])} (${result.deleted} objects)`,
      });
      return c.json(result);
    })

    .post('/:bucket/copy', write, validate('param', bucketParam), validate('json', copySchema), async (c) => {
      const conn = c.get('conn');
      const input = c.req.valid('json');
      const result = await copyItems(conn.handle.client, c.req.valid('param').bucket, input);
      logActivity(ctx, c, input.move ? 'object.move' : 'object.copy', {
        bucket: c.req.valid('param').bucket,
        detail: `${describeKeys(input.items.map((i) => `${i.source} → ${input.destinationBucket}/${i.destination}`))}`,
      });
      return c.json(result);
    })

    .post('/:bucket/presign', validate('param', bucketParam), validate('json', presignSchema), async (c) => {
      const conn = c.get('conn');
      const input = c.req.valid('json');
      if (input.method === 'PUT' && ctx.config.readonly) {
        throw new HttpError(403, 'READONLY', 'Upload links are disabled in read-only mode');
      }
      return c.json(await presign(conn.handle.client, c.req.valid('param').bucket, input));
    })

    .post('/:bucket/metadata', write, validate('param', bucketParam), validate('json', metadataSchema), async (c) => {
      const conn = c.get('conn');
      const { bucket } = c.req.valid('param');
      const { keys, ...changes } = c.req.valid('json');
      await mapLimit(keys, 8, (key) => updateMetadata(conn.handle.client, bucket, key, changes));
      logActivity(ctx, c, 'object.metadata', { bucket, detail: describeKeys(keys) });
      return c.json({ updated: keys.length });
    })

    .get('/:bucket/tags', validate('param', bucketParam), validate('query', keyQuerySchema), async (c) => {
      const conn = c.get('conn');
      const { key, versionId } = c.req.valid('query');
      return c.json({ tags: await getTags(conn.handle.client, c.req.valid('param').bucket, key, versionId) });
    })

    .put('/:bucket/tags', write, validate('param', bucketParam), validate('json', tagsSchema), async (c) => {
      const conn = c.get('conn');
      if (!conn.provider.capabilities.tagging) throw new HttpError(501, 'UNSUPPORTED', 'Tags are not supported by this provider');
      const { bucket } = c.req.valid('param');
      const { keys, tags, versionId } = c.req.valid('json');
      await mapLimit(keys, 8, (key) => setTags(conn.handle.client, bucket, key, tags, keys.length === 1 ? versionId : undefined));
      logActivity(ctx, c, 'object.tags', { bucket, detail: describeKeys(keys) });
      return c.json({ updated: keys.length });
    })

    .get('/:bucket/versions', validate('param', bucketParam), validate('query', z.object({ key: objectKeySchema })), async (c) => {
      const conn = c.get('conn');
      return c.json({ versions: await listVersions(conn.handle.client, c.req.valid('param').bucket, c.req.valid('query').key) });
    })

    .post('/:bucket/versions/restore', write, validate('param', bucketParam), validate('json', versionActionSchema), async (c) => {
      const conn = c.get('conn');
      const { key, versionId } = c.req.valid('json');
      await restoreVersion(conn.handle.client, c.req.valid('param').bucket, key, versionId);
      logActivity(ctx, c, 'version.restore', { bucket: c.req.valid('param').bucket, detail: `${key} @ ${versionId}` });
      return c.json({ ok: true });
    })

    .post('/:bucket/versions/delete', write, validate('param', bucketParam), validate('json', versionActionSchema), async (c) => {
      const conn = c.get('conn');
      const { key, versionId } = c.req.valid('json');
      await deleteVersion(conn.handle.client, c.req.valid('param').bucket, key, versionId);
      logActivity(ctx, c, 'version.delete', { bucket: c.req.valid('param').bucket, detail: `${key} @ ${versionId}` });
      return c.json({ ok: true });
    })

    /** Step 1 of a ZIP download: store the selection, return a one-time token. */
    .post('/:bucket/zip', validate('param', bucketParam), validate('json', zipSchema), async (c) => {
      const conn = c.get('conn');
      const session = c.get('session');
      const { bucket } = c.req.valid('param');
      const input = c.req.valid('json');
      if (input.keys.length + input.prefixes.length === 0) throw new HttpError(400, 'VALIDATION', 'Nothing selected');
      const folderName = input.base.split('/').filter(Boolean).pop();
      const name = (input.name || folderName || bucket).replace(/[^\w.-]+/g, '_');
      const token = ctx.zipTokens.create({
        sessionId: session.id,
        connectionId: conn.id,
        bucket,
        base: input.base,
        keys: input.keys,
        prefixes: input.prefixes,
        name: name.endsWith('.zip') ? name : `${name}.zip`,
      });
      return c.json({ token });
    })

    /* ---------------------- Resumable uploads (client-driven multipart) ---------------------- */

    .post('/:bucket/multipart', write, validate('param', bucketParam), validate('json', multipartCreateSchema), async (c) => {
      const conn = c.get('conn');
      const { key, contentType } = c.req.valid('json');
      const type = contentType || mime.lookup(key) || 'application/octet-stream';
      return c.json(await createMultipart(conn.handle.client, c.req.valid('param').bucket, key, type), 201);
    })

    .get('/:bucket/multipart/parts', validate('param', bucketParam), validate('query', multipartRefSchema), async (c) => {
      const conn = c.get('conn');
      const { key, uploadId } = c.req.valid('query');
      return c.json({ parts: await listParts(conn.handle.client, c.req.valid('param').bucket, key, uploadId) });
    })

    .put('/:bucket/multipart/part', write, validate('param', bucketParam), validate('query', multipartPartQuerySchema), async (c) => {
      const conn = c.get('conn');
      const declared = Number(c.req.header('content-length') ?? NaN);
      if (!Number.isFinite(declared) || declared <= 0) throw new HttpError(411, 'LENGTH_REQUIRED', 'Parts need a Content-Length');
      if (declared > MAX_PART_BYTES) throw new HttpError(413, 'TOO_LARGE', 'Part is too large');
      const body = new Uint8Array(await c.req.arrayBuffer());
      if (body.byteLength !== declared) throw new HttpError(400, 'INCOMPLETE', 'Part was not fully received');
      const { key, uploadId, partNumber } = c.req.valid('query');
      return c.json(await uploadPart(conn.handle.client, c.req.valid('param').bucket, key, uploadId, partNumber, body));
    })

    .post('/:bucket/multipart/complete', write, validate('param', bucketParam), validate('json', multipartCompleteSchema), async (c) => {
      const conn = c.get('conn');
      const { bucket } = c.req.valid('param');
      const { key, uploadId, parts } = c.req.valid('json');
      const result = await completeMultipart(conn.handle.client, bucket, key, uploadId, parts);
      logActivity(ctx, c, 'object.upload', { bucket, detail: key });
      return c.json({ key, ...result });
    })

    .post('/:bucket/multipart/abort', write, validate('param', bucketParam), validate('json', multipartRefSchema), async (c) => {
      const conn = c.get('conn');
      const { bucket } = c.req.valid('param');
      const { key, uploadId } = c.req.valid('json');
      await abortMultipart(conn.handle.client, bucket, key, uploadId);
      logActivity(ctx, c, 'upload.abort', { bucket, detail: key });
      return c.json({ ok: true });
    })

    /** Unfinished multipart uploads (they cost storage until aborted). */
    .get('/:bucket/multipart', validate('param', bucketParam), async (c) => {
      const conn = c.get('conn');
      return c.json({ uploads: await listIncomplete(conn.handle.client, c.req.valid('param').bucket) });
    })

    /* ------------------------------ Deleted objects (versioned) ------------------------------ */

    .get('/:bucket/deleted', validate('param', bucketParam), validate('query', deletedQuerySchema), async (c) => {
      const conn = c.get('conn');
      const { prefix, cursor } = c.req.valid('query');
      return c.json(await listDeleted(conn.handle.client, c.req.valid('param').bucket, prefix, cursor));
    })

    /* ------------------------------ Storage class & archive ------------------------------ */

    .post('/:bucket/storage-class', write, validate('param', bucketParam), validate('json', storageClassSchema), async (c) => {
      const conn = c.get('conn');
      const { bucket } = c.req.valid('param');
      const { keys, storageClass } = c.req.valid('json');
      if (!conn.provider.capabilities.storageClasses.includes(storageClass)) {
        throw new HttpError(400, 'UNSUPPORTED', `${conn.provider.name} doesn't offer the ${storageClass} storage class`);
      }
      await mapLimit(keys, 4, (key) => changeStorageClass(conn.handle.client, bucket, key, storageClass));
      logActivity(ctx, c, 'object.storage-class', { bucket, detail: `${describeKeys(keys)} → ${storageClass}` });
      return c.json({ updated: keys.length });
    })

    .post('/:bucket/restore-archive', write, validate('param', bucketParam), validate('json', restoreArchiveSchema), async (c) => {
      const conn = c.get('conn');
      if (!conn.provider.capabilities.archiveRestore) throw new HttpError(501, 'UNSUPPORTED', 'Archive restore is not supported by this provider');
      const { bucket } = c.req.valid('param');
      const { keys, days, tier } = c.req.valid('json');
      await mapLimit(keys, 8, (key) => restoreArchived(conn.handle.client, bucket, key, days, tier));
      logActivity(ctx, c, 'object.restore-archive', { bucket, detail: `${describeKeys(keys)} (${tier}, ${days} days)` });
      return c.json({ requested: keys.length });
    });
}
