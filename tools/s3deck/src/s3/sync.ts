import type { Readable } from 'node:stream';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { CompareItem, CompareResult } from '../shared/types';
import { errorMessage } from './errors';
import { walkObjects } from './listing';
import { copyObject, deleteKeys, mapLimit } from './transfers';

export interface Location {
  client: S3Client;
  bucket: string;
  prefix: string;
}

interface Meta {
  size: number;
  etag: string | null;
}

/** Up to this many objects per side are compared. */
export const COMPARE_LIMIT = 200_000;

async function index(loc: Location, signal?: AbortSignal): Promise<{ map: Map<string, Meta>; truncated: boolean }> {
  const map = new Map<string, Meta>();
  for await (const page of walkObjects(loc.client, loc.bucket, loc.prefix, signal)) {
    for (const o of page) {
      const key = o.Key as string;
      if (key.endsWith('/')) continue;
      map.set(key.slice(loc.prefix.length), { size: o.Size ?? 0, etag: o.ETag?.replaceAll('"', '') ?? null });
      if (map.size >= COMPARE_LIMIT) return { map, truncated: true };
    }
  }
  return { map, truncated: false };
}

/** Same content? Size must match; single-part ETags (plain MD5) must match when both sides have one. */
export function sameObject(a: Meta, b: Meta): boolean {
  if (a.size !== b.size) return false;
  const comparable = a.etag && b.etag && !a.etag.includes('-') && !b.etag.includes('-');
  return comparable ? a.etag === b.etag : true;
}

export async function compareLocations(source: Location, target: Location, signal?: AbortSignal): Promise<CompareResult> {
  const [s, t] = await Promise.all([index(source, signal), index(target, signal)]);
  const items: CompareItem[] = [];
  const counts = { missing: 0, changed: 0, extra: 0, same: 0 };
  let bytesToCopy = 0;

  for (const [key, meta] of s.map) {
    const other = t.map.get(key);
    const status: CompareItem['status'] = !other ? 'missing' : sameObject(meta, other) ? 'same' : 'changed';
    counts[status]++;
    if (status !== 'same') bytesToCopy += meta.size;
    items.push({ key, status, sourceSize: meta.size, targetSize: other?.size ?? null });
  }
  for (const [key, meta] of t.map) {
    if (s.map.has(key)) continue;
    counts.extra++;
    items.push({ key, status: 'extra', sourceSize: null, targetSize: meta.size });
  }
  items.sort((a, b) => a.key.localeCompare(b.key));
  return { items, counts, bytesToCopy, truncated: s.truncated || t.truncated };
}

export interface SyncProgress {
  total: number;
  done: number;
  bytesDone: number;
  bytesTotal: number;
  errors: { key: string; message: string }[];
}

/**
 * Copies missing and changed objects from source to target ("mirror" also deletes extras).
 * Same connection: server-side copy. Different connections: streamed through s3deck.
 */
export async function runSync(opts: {
  source: Location;
  target: Location;
  sameConnection: boolean;
  mode: 'copy' | 'mirror';
  signal: AbortSignal;
  progress: SyncProgress;
}) {
  const { source, target, progress, signal } = opts;
  const diff = await compareLocations(source, target, signal);
  const toCopy = diff.items.filter((i) => i.status === 'missing' || i.status === 'changed');
  const toDelete = opts.mode === 'mirror' ? diff.items.filter((i) => i.status === 'extra') : [];
  progress.total = toCopy.length + toDelete.length;
  progress.bytesTotal = diff.bytesToCopy;

  await mapLimit(toCopy, 4, async (item) => {
    if (signal.aborted) return;
    const sourceKey = source.prefix + item.key;
    const targetKey = target.prefix + item.key;
    try {
      if (opts.sameConnection) {
        await copyObject(source.client, {
          sourceBucket: source.bucket,
          sourceKey,
          destinationBucket: target.bucket,
          destinationKey: targetKey,
          size: item.sourceSize ?? 0,
        });
      } else {
        const got = await source.client.send(new GetObjectCommand({ Bucket: source.bucket, Key: sourceKey }), { abortSignal: signal });
        const upload = new Upload({
          client: target.client,
          params: {
            Bucket: target.bucket,
            Key: targetKey,
            Body: got.Body as Readable,
            ContentType: got.ContentType,
            CacheControl: got.CacheControl,
            ContentDisposition: got.ContentDisposition,
            ContentEncoding: got.ContentEncoding,
            Metadata: got.Metadata,
          },
          partSize: 16 * 1024 * 1024,
          queueSize: 2,
        });
        const onAbort = () => void upload.abort().catch(() => {});
        signal.addEventListener('abort', onAbort, { once: true });
        try {
          await upload.done();
        } finally {
          signal.removeEventListener('abort', onAbort);
        }
      }
      progress.bytesDone += item.sourceSize ?? 0;
    } catch (err) {
      if (!signal.aborted) progress.errors.push({ key: item.key, message: errorMessage(err) });
    } finally {
      progress.done++;
    }
  });

  if (toDelete.length && !signal.aborted) {
    const result = await deleteKeys(target.client, target.bucket, toDelete.map((i) => target.prefix + i.key));
    progress.errors.push(...result.errors);
    progress.done += toDelete.length;
  }
}
