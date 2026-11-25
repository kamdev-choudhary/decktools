import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListMultipartUploadsCommand,
  ListPartsCommand,
  type S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import type { MultipartUploadInfo, UploadPartInfo } from '../shared/types';

/**
 * Client-driven multipart uploads. The browser splits a file into parts and sends them one by
 * one, so an interrupted upload can resume from the parts S3 already has.
 */
export async function createMultipart(client: S3Client, bucket: string, key: string, contentType?: string) {
  const out = await client.send(
    new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
  );
  if (!out.UploadId) throw new Error('Storage did not return an upload ID');
  return { uploadId: out.UploadId };
}

export async function uploadPart(
  client: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
  partNumber: number,
  body: Uint8Array,
) {
  const out = await client.send(
    new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: body,
      ContentLength: body.byteLength,
    }),
  );
  return { etag: out.ETag ?? '' };
}

export async function listParts(
  client: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<UploadPartInfo[]> {
  const parts: UploadPartInfo[] = [];
  let marker: string | undefined;
  do {
    const out = await client.send(
      new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }),
    );
    for (const p of out.Parts ?? []) {
      if (p.PartNumber && p.ETag) parts.push({ partNumber: p.PartNumber, etag: p.ETag, size: p.Size ?? 0 });
    }
    marker = out.IsTruncated ? out.NextPartNumberMarker : undefined;
  } while (marker);
  return parts;
}

export async function completeMultipart(
  client: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string }[],
) {
  const sorted = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);
  const out = await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: sorted },
    }),
  );
  return { etag: out.ETag ?? null };
}

export async function abortMultipart(client: S3Client, bucket: string, key: string, uploadId: string) {
  await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
}

/** Unfinished multipart uploads in a bucket. Their parts are billed until aborted. */
export async function listIncomplete(client: S3Client, bucket: string, limit = 5000): Promise<MultipartUploadInfo[]> {
  const out: MultipartUploadInfo[] = [];
  let keyMarker: string | undefined;
  let idMarker: string | undefined;
  do {
    const page = await client.send(
      new ListMultipartUploadsCommand({ Bucket: bucket, KeyMarker: keyMarker, UploadIdMarker: idMarker }),
    );
    for (const u of page.Uploads ?? []) {
      if (u.Key && u.UploadId) {
        out.push({
          key: u.Key,
          uploadId: u.UploadId,
          initiated: u.Initiated?.toISOString() ?? null,
          storageClass: u.StorageClass ?? null,
        });
      }
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    idMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined;
  } while (keyMarker && out.length < limit);
  return out;
}
