import { once } from 'node:events';
import type { Readable } from 'node:stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  type CopyObjectCommandInput,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type S3Client,
  UploadPartCopyCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { ZipArchive } from 'archiver';
import { MAX_DELETE_BATCH, MAX_SINGLE_COPY_BYTES } from '../shared/constants';
import type { CopyResponse, DeleteResponse } from '../shared/types';
import { copySource } from './client';
import { errorMessage, UserError } from './errors';
import { walkObjects } from './listing';

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

export const UPLOAD_PART_SIZE = 16 * 1024 * 1024;
export const UPLOAD_QUEUE_SIZE = 4;

/** Streams a body to S3. Large bodies use multipart upload with parallel parts. */
export async function uploadStream(
  client: S3Client,
  opts: { bucket: string; key: string; body: Readable; contentType?: string; signal?: AbortSignal },
): Promise<{ etag: string | null }> {
  const upload = new Upload({
    client,
    params: { Bucket: opts.bucket, Key: opts.key, Body: opts.body, ContentType: opts.contentType },
    partSize: UPLOAD_PART_SIZE,
    queueSize: UPLOAD_QUEUE_SIZE,
    leavePartsOnError: false,
  });
  const onAbort = () => void upload.abort().catch(() => {});
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const out = await upload.done();
    return { etag: out.ETag ?? null };
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

type ReplaceHeaders = Pick<
  CopyObjectCommandInput,
  | 'ContentType'
  | 'CacheControl'
  | 'ContentDisposition'
  | 'ContentEncoding'
  | 'ContentLanguage'
  | 'Metadata'
  | 'StorageClass'
>;

const COPY_PART_SIZE = 512 * 1024 * 1024;

/** Server-side copy. Uses multipart copy above 5 GB. `replace` rewrites headers and metadata. */
export async function copyObject(
  client: S3Client,
  o: {
    sourceBucket: string;
    sourceKey: string;
    sourceVersionId?: string;
    destinationBucket: string;
    destinationKey: string;
    size: number;
    replace?: ReplaceHeaders;
  },
): Promise<void> {
  const source = copySource(o.sourceBucket, o.sourceKey, o.sourceVersionId);

  if (o.size <= MAX_SINGLE_COPY_BYTES) {
    await client.send(
      new CopyObjectCommand({
        Bucket: o.destinationBucket,
        Key: o.destinationKey,
        CopySource: source,
        ...(o.replace ? { MetadataDirective: 'REPLACE', ...o.replace } : {}),
      }),
    );
    return;
  }

  // Multipart copy doesn't carry headers over, so read them first when not replacing.
  let headers: ReplaceHeaders | undefined = o.replace;
  if (!headers) {
    const h = await client.send(
      new HeadObjectCommand({ Bucket: o.sourceBucket, Key: o.sourceKey, VersionId: o.sourceVersionId }),
    );
    headers = {
      ContentType: h.ContentType,
      CacheControl: h.CacheControl,
      ContentDisposition: h.ContentDisposition,
      ContentEncoding: h.ContentEncoding,
      ContentLanguage: h.ContentLanguage,
      Metadata: h.Metadata,
      StorageClass: h.StorageClass,
    };
  }

  const { UploadId } = await client.send(
    new CreateMultipartUploadCommand({ Bucket: o.destinationBucket, Key: o.destinationKey, ...headers }),
  );
  try {
    const ranges: { part: number; start: number; end: number }[] = [];
    for (let start = 0, part = 1; start < o.size; start += COPY_PART_SIZE, part++) {
      ranges.push({ part, start, end: Math.min(start + COPY_PART_SIZE, o.size) - 1 });
    }
    const parts = await mapLimit(ranges, 4, async (r) => {
      const out = await client.send(
        new UploadPartCopyCommand({
          Bucket: o.destinationBucket,
          Key: o.destinationKey,
          UploadId,
          PartNumber: r.part,
          CopySource: source,
          CopySourceRange: `bytes=${r.start}-${r.end}`,
        }),
      );
      return { PartNumber: r.part, ETag: out.CopyPartResult?.ETag };
    });
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: o.destinationBucket,
        Key: o.destinationKey,
        UploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  } catch (err) {
    await client
      .send(new AbortMultipartUploadCommand({ Bucket: o.destinationBucket, Key: o.destinationKey, UploadId }))
      .catch(() => {});
    throw err;
  }
}

/** Copies (or moves) keys and folders. Folder sources end in "/" and copy everything under them. */
export async function copyItems(
  client: S3Client,
  sourceBucket: string,
  input: { destinationBucket: string; move: boolean; items: { source: string; destination: string }[] },
): Promise<CopyResponse> {
  let copied = 0;
  let deleted = 0;
  const toDelete: string[] = [];

  for (const item of input.items) {
    if (item.source === item.destination && sourceBucket === input.destinationBucket) continue;

    if (item.source.endsWith('/')) {
      if (sourceBucket === input.destinationBucket && item.destination.startsWith(item.source)) {
        throw new UserError(`Can't copy "${item.source}" into itself`);
      }
      for await (const page of walkObjects(client, sourceBucket, item.source)) {
        await mapLimit(page, 8, async (obj) => {
          const key = obj.Key as string;
          await copyObject(client, {
            sourceBucket,
            sourceKey: key,
            destinationBucket: input.destinationBucket,
            destinationKey: item.destination + key.slice(item.source.length),
            size: obj.Size ?? 0,
          });
          copied++;
          if (input.move) toDelete.push(key);
        });
      }
    } else {
      const head = await client.send(new HeadObjectCommand({ Bucket: sourceBucket, Key: item.source }));
      await copyObject(client, {
        sourceBucket,
        sourceKey: item.source,
        destinationBucket: input.destinationBucket,
        destinationKey: item.destination,
        size: head.ContentLength ?? 0,
      });
      copied++;
      if (input.move) toDelete.push(item.source);
    }
  }

  if (input.move && toDelete.length) {
    const result = await deleteKeys(client, sourceBucket, toDelete);
    deleted = result.deleted;
    if (result.errors.length) {
      throw new Error(
        `Copied ${copied} objects, but ${result.errors.length} originals could not be deleted: ${result.errors[0]?.message}`,
      );
    }
  }
  return { copied, deleted };
}

/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */

/** Deletes keys in batches of 1,000. */
export async function deleteKeys(client: S3Client, bucket: string, keys: string[]): Promise<DeleteResponse> {
  const result: DeleteResponse = { deleted: 0, errors: [] };
  for (let i = 0; i < keys.length; i += MAX_DELETE_BATCH) {
    const batch = keys.slice(i, i + MAX_DELETE_BATCH);
    const out = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    const errors = (out.Errors ?? []).map((e) => ({ key: e.Key ?? '', message: e.Message ?? e.Code ?? 'Failed' }));
    result.errors.push(...errors);
    result.deleted += batch.length - errors.length;
  }
  return result;
}

/** Deletes keys and everything under the given folder prefixes. */
export async function deleteItems(
  client: S3Client,
  bucket: string,
  input: { keys: string[]; prefixes: string[] },
): Promise<DeleteResponse> {
  const result = await deleteKeys(client, bucket, input.keys);
  for (const prefix of input.prefixes) {
    if (!prefix) throw new UserError('Refusing to delete the whole bucket this way');
    let batch: string[] = [];
    const flush = async () => {
      const r = await deleteKeys(client, bucket, batch);
      result.deleted += r.deleted;
      result.errors.push(...r.errors);
      batch = [];
    };
    for await (const page of walkObjects(client, bucket, prefix)) {
      for (const o of page) batch.push(o.Key as string);
      if (batch.length >= MAX_DELETE_BATCH) await flush();
    }
    if (batch.length) await flush();
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* ZIP download                                                        */
/* ------------------------------------------------------------------ */

/** Builds a ZIP on the fly from keys and folders. Objects are fetched one at a time. */
export function zipStream(
  client: S3Client,
  bucket: string,
  input: { base: string; keys: string[]; prefixes: string[] },
  signal?: AbortSignal,
): ZipArchive {
  const archive = new ZipArchive({ zlib: { level: 1 } });

  const entryName = (key: string) => (key.startsWith(input.base) ? key.slice(input.base.length) : key) || key;

  const appendOne = async (key: string, lastModified?: Date) => {
    if (key.endsWith('/')) return; // folder marker
    const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal });
    const body = out.Body as Readable;
    const done = once(archive, 'entry', { signal });
    archive.append(body, { name: entryName(key), date: lastModified ?? out.LastModified ?? new Date() });
    await done;
  };

  (async () => {
    for (const key of input.keys) await appendOne(key);
    for (const prefix of input.prefixes) {
      for await (const page of walkObjects(client, bucket, prefix, signal)) {
        for (const o of page) await appendOne(o.Key as string, o.LastModified);
      }
    }
    await archive.finalize();
  })().catch((err: unknown) => {
    if (!signal?.aborted) console.error(`  ZIP download failed: ${errorMessage(err)}`);
    archive.abort();
    archive.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  return archive;
}
