import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  ListObjectVersionsCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
  DeleteObjectTaggingCommand,
  GetObjectLegalHoldCommand,
  RestoreObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { MetadataInput, PresignInput } from '../shared/schemas';
import type {
  DeletedEntry,
  DeletedListResponse,
  ObjectDetails,
  PresignResponse,
  Tag,
  VersionEntry,
} from '../shared/types';
import { UserError } from './errors';
import { ARCHIVE_CLASSES } from './provider';
import { copyObject } from './transfers';

export async function headObject(client: S3Client, bucket: string, key: string, versionId?: string) {
  return client.send(new HeadObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }));
}

export function headersOf(h: HeadObjectCommandOutput): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (name: string, v: unknown) => {
    if (v === undefined || v === null || v === '') return;
    out[name] = v instanceof Date ? v.toUTCString() : String(v);
  };
  add('Content-Type', h.ContentType);
  add('Content-Length', h.ContentLength);
  add('Content-Encoding', h.ContentEncoding);
  add('Content-Disposition', h.ContentDisposition);
  add('Content-Language', h.ContentLanguage);
  add('Cache-Control', h.CacheControl);
  add('Expires', h.ExpiresString ?? h.Expires);
  add('ETag', h.ETag);
  add('Last-Modified', h.LastModified);
  add('x-amz-version-id', h.VersionId);
  add('x-amz-storage-class', h.StorageClass);
  add('x-amz-server-side-encryption', h.ServerSideEncryption);
  add('x-amz-website-redirect-location', h.WebsiteRedirectLocation);
  add('x-amz-replication-status', h.ReplicationStatus);
  add('x-amz-restore', h.Restore);
  add('x-amz-object-lock-mode', h.ObjectLockMode);
  add('x-amz-object-lock-retain-until-date', h.ObjectLockRetainUntilDate);
  add('x-amz-tagging-count', h.TagCount);
  return out;
}

export async function createFolder(client: S3Client, bucket: string, prefix: string) {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: prefix, Body: '', ContentLength: 0 }));
}

export async function presign(client: S3Client, bucket: string, input: PresignInput): Promise<PresignResponse> {
  const command =
    input.method === 'GET'
      ? new GetObjectCommand({ Bucket: bucket, Key: input.key, VersionId: input.versionId })
      : new PutObjectCommand({ Bucket: bucket, Key: input.key, ContentType: input.contentType || undefined });
  const url = await getSignedUrl(client, command, { expiresIn: input.expiresIn });
  return { url, expiresAt: new Date(Date.now() + input.expiresIn * 1000).toISOString() };
}

/** Rewrites an object's headers and metadata in place (copy onto itself with REPLACE). */
export async function updateMetadata(
  client: S3Client,
  bucket: string,
  key: string,
  input: Omit<MetadataInput, 'keys'>,
) {
  const head = await headObject(client, bucket, key);
  const pick = (next: string | undefined, current: string | undefined) =>
    next === undefined ? current : next === '' ? undefined : next;

  await copyObject(client, {
    sourceBucket: bucket,
    sourceKey: key,
    destinationBucket: bucket,
    destinationKey: key,
    size: head.ContentLength ?? 0,
    replace: {
      ContentType: pick(input.contentType, head.ContentType),
      CacheControl: pick(input.cacheControl, head.CacheControl),
      ContentDisposition: pick(input.contentDisposition, head.ContentDisposition),
      ContentEncoding: pick(input.contentEncoding, head.ContentEncoding),
      ContentLanguage: head.ContentLanguage,
      Metadata: input.metadata ?? head.Metadata ?? {},
      StorageClass: head.StorageClass,
    },
  });
}

export async function getTags(client: S3Client, bucket: string, key: string, versionId?: string): Promise<Tag[]> {
  const out = await client.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key, VersionId: versionId }));
  return (out.TagSet ?? []).map((t) => ({ Key: t.Key ?? '', Value: t.Value ?? '' }));
}

export async function setTags(client: S3Client, bucket: string, key: string, tags: Tag[], versionId?: string) {
  if (tags.length === 0) {
    await client.send(new DeleteObjectTaggingCommand({ Bucket: bucket, Key: key, VersionId: versionId }));
    return;
  }
  await client.send(
    new PutObjectTaggingCommand({ Bucket: bucket, Key: key, VersionId: versionId, Tagging: { TagSet: tags } }),
  );
}

/** Lists the versions and delete markers of one key, newest first. */
export async function listVersions(client: S3Client, bucket: string, key: string): Promise<VersionEntry[]> {
  const entries: VersionEntry[] = [];
  let keyMarker: string | undefined;
  let versionMarker: string | undefined;
  do {
    const out = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: key,
        KeyMarker: keyMarker,
        VersionIdMarker: versionMarker,
      }),
    );
    for (const v of out.Versions ?? []) {
      if (v.Key !== key) continue;
      entries.push({
        versionId: v.VersionId ?? 'null',
        isLatest: !!v.IsLatest,
        isDeleteMarker: false,
        size: v.Size ?? 0,
        lastModified: v.LastModified?.toISOString() ?? null,
        etag: v.ETag ?? null,
        storageClass: v.StorageClass ?? null,
      });
    }
    for (const m of out.DeleteMarkers ?? []) {
      if (m.Key !== key) continue;
      entries.push({
        versionId: m.VersionId ?? 'null',
        isLatest: !!m.IsLatest,
        isDeleteMarker: true,
        size: 0,
        lastModified: m.LastModified?.toISOString() ?? null,
        etag: null,
        storageClass: null,
      });
    }
    // Stop once the listing has moved past our key.
    const passed = out.NextKeyMarker !== undefined && out.NextKeyMarker !== key;
    keyMarker = out.IsTruncated && !passed ? out.NextKeyMarker : undefined;
    versionMarker = out.IsTruncated && !passed ? out.NextVersionIdMarker : undefined;
  } while (keyMarker);

  return entries.sort((a, b) => (b.lastModified ?? '').localeCompare(a.lastModified ?? ''));
}

/** Makes an older version the current one by copying it on top. */
export async function restoreVersion(client: S3Client, bucket: string, key: string, versionId: string) {
  const head = await headObject(client, bucket, key, versionId);
  await copyObject(client, {
    sourceBucket: bucket,
    sourceKey: key,
    sourceVersionId: versionId,
    destinationBucket: bucket,
    destinationKey: key,
    size: head.ContentLength ?? 0,
  });
}

export async function deleteVersion(client: S3Client, bucket: string, key: string, versionId: string) {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }));
}

/* ------------------------------------------------------------------ */
/* Encryption, lock and archive details                                */
/* ------------------------------------------------------------------ */

/** Parses the x-amz-restore header: ongoing-request="false", expiry-date="Fri, 21 Dec 2012 00:00:00 GMT" */
export function parseRestore(header: string | undefined): Pick<ObjectDetails['archive'], 'restore' | 'restoreExpiry'> {
  if (!header) return { restore: 'none', restoreExpiry: null };
  if (/ongoing-request="true"/.test(header)) return { restore: 'in-progress', restoreExpiry: null };
  const expiry = header.match(/expiry-date="([^"]+)"/)?.[1];
  return { restore: 'restored', restoreExpiry: expiry ? new Date(expiry).toISOString() : null };
}

export async function objectExtras(
  client: S3Client,
  bucket: string,
  key: string,
  h: HeadObjectCommandOutput,
  opts: { objectLock: boolean },
): Promise<Pick<ObjectDetails, 'encryption' | 'lock' | 'archive'>> {
  let legalHold: boolean | null = null;
  if (opts.objectLock && (h.ObjectLockMode || h.ObjectLockLegalHoldStatus === undefined)) {
    try {
      const lh = await client.send(new GetObjectLegalHoldCommand({ Bucket: bucket, Key: key, VersionId: h.VersionId }));
      legalHold = lh.LegalHold?.Status === 'ON';
    } catch {
      legalHold = null; // bucket without object lock, or no permission
    }
  }
  if (h.ObjectLockLegalHoldStatus) legalHold = h.ObjectLockLegalHoldStatus === 'ON';
  const hasLock = !!h.ObjectLockMode || legalHold !== null;
  return {
    encryption: h.ServerSideEncryption
      ? { algorithm: h.ServerSideEncryption, kmsKeyId: h.SSEKMSKeyId ?? null, bucketKeyEnabled: !!h.BucketKeyEnabled }
      : null,
    lock: hasLock
      ? { mode: h.ObjectLockMode ?? null, retainUntil: h.ObjectLockRetainUntilDate?.toISOString() ?? null, legalHold }
      : null,
    archive: { archived: ARCHIVE_CLASSES.has(h.StorageClass ?? ''), ...parseRestore(h.Restore) },
  };
}

/* ------------------------------------------------------------------ */
/* Storage class & archive restore                                     */
/* ------------------------------------------------------------------ */

/** Rewrites the object in place with a new storage class, keeping its headers and metadata. */
export async function changeStorageClass(client: S3Client, bucket: string, key: string, storageClass: string) {
  const head = await headObject(client, bucket, key);
  if (ARCHIVE_CLASSES.has(head.StorageClass ?? '') && parseRestore(head.Restore).restore !== 'restored') {
    throw new UserError(`"${key}" is archived. Restore it before changing its storage class.`);
  }
  await copyObject(client, {
    sourceBucket: bucket,
    sourceKey: key,
    destinationBucket: bucket,
    destinationKey: key,
    size: head.ContentLength ?? 0,
    replace: {
      ContentType: head.ContentType,
      CacheControl: head.CacheControl,
      ContentDisposition: head.ContentDisposition,
      ContentEncoding: head.ContentEncoding,
      ContentLanguage: head.ContentLanguage,
      Metadata: head.Metadata ?? {},
      StorageClass: storageClass as never,
    },
  });
}

/** Asks for a temporary readable copy of an archived (Glacier / Deep Archive) object. */
export async function restoreArchived(
  client: S3Client,
  bucket: string,
  key: string,
  days: number,
  tier: 'Expedited' | 'Standard' | 'Bulk',
) {
  try {
    await client.send(
      new RestoreObjectCommand({
        Bucket: bucket,
        Key: key,
        RestoreRequest: { Days: days, GlacierJobParameters: { Tier: tier } },
      }),
    );
  } catch (err) {
    // Already running: not an error from the user's point of view.
    if ((err as { name?: string }).name === 'RestoreAlreadyInProgress') return;
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Deleted objects (versioned buckets)                                 */
/* ------------------------------------------------------------------ */

/**
 * Objects in a folder whose latest version is a delete marker. Removing that marker restores
 * the object. Pages through ListObjectVersions with "/" as delimiter.
 */
export async function listDeleted(
  client: S3Client,
  bucket: string,
  prefix: string,
  cursor?: string,
): Promise<DeletedListResponse> {
  let keyMarker: string | undefined;
  let versionMarker: string | undefined;
  if (cursor)
    [keyMarker, versionMarker] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [string, string];

  const objects: DeletedEntry[] = [];
  let next: string | null = null;
  // Scan up to a few pages so a page of results isn't mostly empty.
  for (let i = 0; i < 5; i++) {
    const out = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: prefix || undefined,
        Delimiter: '/',
        KeyMarker: keyMarker,
        VersionIdMarker: versionMarker,
        MaxKeys: 1000,
      }),
    );
    for (const m of out.DeleteMarkers ?? []) {
      if (!m.IsLatest || !m.Key || !m.VersionId || m.Key.endsWith('/')) continue;
      objects.push({
        key: m.Key,
        name: m.Key.split('/').pop() || m.Key,
        deletedAt: m.LastModified?.toISOString() ?? null,
        markerVersionId: m.VersionId,
      });
    }
    if (!out.IsTruncated) {
      next = null;
      break;
    }
    keyMarker = out.NextKeyMarker;
    versionMarker = out.NextVersionIdMarker;
    next = Buffer.from(JSON.stringify([keyMarker, versionMarker])).toString('base64url');
    if (objects.length >= 200) break;
  }
  return { objects, nextCursor: next };
}
