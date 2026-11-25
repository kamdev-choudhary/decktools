import { ListObjectsV2Command, type _Object, type S3Client } from '@aws-sdk/client-s3';
import type { FolderEntry, ListResponse, ObjectEntry, SummaryResponse } from '../shared/types';

function baseName(key: string, prefix: string): string {
  return key.slice(prefix.length).replace(/\/$/, '');
}

export function toObjectEntry(o: _Object): ObjectEntry {
  const key = o.Key ?? '';
  return {
    type: 'object',
    key,
    name: key.split('/').pop() || key,
    size: o.Size ?? 0,
    lastModified: o.LastModified?.toISOString() ?? null,
    etag: o.ETag ?? null,
    storageClass: o.StorageClass ?? null,
  };
}

/** Lists one page of a "folder" (prefix + "/" delimiter), or a flat page for search. */
export async function listPage(
  client: S3Client,
  bucket: string,
  opts: { prefix: string; cursor?: string; flat: boolean; limit: number },
): Promise<ListResponse> {
  const out = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: opts.prefix || undefined,
      Delimiter: opts.flat ? undefined : '/',
      ContinuationToken: opts.cursor,
      MaxKeys: opts.limit,
    }),
  );

  const folders: FolderEntry[] = (out.CommonPrefixes ?? [])
    .map((p) => p.Prefix)
    .filter((p): p is string => !!p)
    .map((key) => ({ type: 'folder', key, name: baseName(key, opts.prefix) }));

  // Hide zero-byte "folder marker" objects (keys ending in "/").
  const objects = (out.Contents ?? [])
    .filter((o) => o.Key && o.Key !== opts.prefix && !o.Key.endsWith('/'))
    .map((o) => toObjectEntry(o));

  return {
    prefix: opts.prefix,
    folders,
    objects,
    nextCursor: out.IsTruncated ? (out.NextContinuationToken ?? null) : null,
  };
}

/** Yields every object under a prefix, page by page (1,000 at a time). */
export async function* walkObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
  signal?: AbortSignal,
): AsyncGenerator<_Object[]> {
  let token: string | undefined;
  do {
    signal?.throwIfAborted();
    const out = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, ContinuationToken: token }),
      { abortSignal: signal },
    );
    const page = (out.Contents ?? []).filter((o) => o.Key);
    if (page.length) yield page;
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
}

/** Counts objects and bytes under a set of prefixes and keys. */
export async function summarize(
  client: S3Client,
  bucket: string,
  prefixes: string[],
  objectSizes: Map<string, number> = new Map(),
  signal?: AbortSignal,
): Promise<SummaryResponse> {
  let objects = objectSizes.size;
  let bytes = [...objectSizes.values()].reduce((a, b) => a + b, 0);
  for (const prefix of prefixes) {
    for await (const page of walkObjects(client, bucket, prefix, signal)) {
      objects += page.length;
      for (const o of page) bytes += o.Size ?? 0;
    }
  }
  return { objects, bytes };
}
