import {
  type BucketLocationConstraint,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteBucketCorsCommand,
  DeleteBucketLifecycleCommand,
  DeleteBucketPolicyCommand,
  DeleteObjectsCommand,
  DeletePublicAccessBlockCommand,
  GetBucketCorsCommand,
  GetBucketEncryptionCommand,
  GetObjectLockConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketLocationCommand,
  GetBucketPolicyCommand,
  GetBucketVersioningCommand,
  GetPublicAccessBlockCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  ListObjectVersionsCommand,
  PutBucketCorsCommand,
  type PutBucketCorsCommandInput,
  PutBucketLifecycleConfigurationCommand,
  type PutBucketLifecycleConfigurationCommandInput,
  PutBucketPolicyCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { MAX_DELETE_BATCH } from '../shared/constants';
import type { BucketInfo, BucketSettings, Capabilities, Setting } from '../shared/types';
import { errorMessage, isNotConfigured, isUnsupported } from './errors';
import { walkObjects } from './listing';
import { deleteKeys } from './transfers';

export async function listBuckets(client: S3Client): Promise<BucketInfo[]> {
  const buckets: BucketInfo[] = [];
  let token: string | undefined;
  do {
    const out = await client.send(new ListBucketsCommand({ ContinuationToken: token }));
    for (const b of out.Buckets ?? []) {
      if (!b.Name) continue;
      buckets.push({ name: b.Name, createdAt: b.CreationDate?.toISOString() ?? null, region: b.BucketRegion ?? null });
    }
    token = out.ContinuationToken;
  } while (token);
  return buckets.sort((a, b) => a.name.localeCompare(b.name));
}

export async function headBucket(client: S3Client, bucket: string) {
  return client.send(new HeadBucketCommand({ Bucket: bucket }));
}

export async function createBucket(client: S3Client, name: string, region: string | undefined, defaultRegion: string) {
  const r = region || defaultRegion;
  const needsConstraint = r && r !== 'us-east-1' && r !== 'auto';
  await client.send(
    new CreateBucketCommand({
      Bucket: name,
      CreateBucketConfiguration: needsConstraint ? { LocationConstraint: r as BucketLocationConstraint } : undefined,
    }),
  );
}

/** Removes every object (and, on versioned buckets, every version and delete marker). */
export async function emptyBucket(client: S3Client, bucket: string, versioned: boolean) {
  if (!versioned) {
    await deleteItemsUnderRoot(client, bucket);
    return;
  }
  let keyMarker: string | undefined;
  let versionMarker: string | undefined;
  do {
    const out = await client.send(
      new ListObjectVersionsCommand({ Bucket: bucket, KeyMarker: keyMarker, VersionIdMarker: versionMarker }),
    );
    const objects = [...(out.Versions ?? []), ...(out.DeleteMarkers ?? [])]
      .filter((v) => v.Key)
      .map((v) => ({ Key: v.Key as string, VersionId: v.VersionId }));
    for (let i = 0; i < objects.length; i += MAX_DELETE_BATCH) {
      await client.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects.slice(i, i + MAX_DELETE_BATCH), Quiet: true } }),
      );
    }
    keyMarker = out.IsTruncated ? out.NextKeyMarker : undefined;
    versionMarker = out.IsTruncated ? out.NextVersionIdMarker : undefined;
  } while (keyMarker);
}

async function deleteItemsUnderRoot(client: S3Client, bucket: string) {
  for await (const page of walkObjects(client, bucket, '')) {
    await deleteKeys(client, bucket, page.map((o) => o.Key as string));
  }
}

export async function deleteBucket(client: S3Client, bucket: string, force: boolean, caps: Capabilities) {
  if (force) {
    let versioned = false;
    if (caps.versioning) {
      try {
        const v = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
        versioned = !!v.Status;
      } catch (err) {
        if (!isUnsupported(err)) throw err;
      }
    }
    await emptyBucket(client, bucket, versioned);
  }
  await client.send(new DeleteBucketCommand({ Bucket: bucket }));
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

async function read<T>(enabled: boolean, empty: T, fn: () => Promise<T>): Promise<Setting<T>> {
  if (!enabled) return { supported: false, value: empty };
  try {
    return { supported: true, value: await fn() };
  } catch (err) {
    if (isNotConfigured(err)) return { supported: true, value: empty };
    if (isUnsupported(err)) return { supported: false, value: empty };
    return { supported: true, value: empty, error: errorMessage(err) };
  }
}

export async function getBucketSettings(client: S3Client, bucket: string, caps: Capabilities): Promise<BucketSettings> {
  const [region, versioning, cors, lifecycle, policy, publicAccessBlock, encryption, objectLock] = await Promise.all([
    client
      .send(new GetBucketLocationCommand({ Bucket: bucket }))
      .then((o) => (o.LocationConstraint as string | undefined) || 'us-east-1')
      .catch(() => null),
    read(caps.versioning, 'Off' as const, async () => {
      const o = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
      return (o.Status ?? 'Off') as 'Enabled' | 'Suspended' | 'Off';
    }),
    read<unknown[]>(caps.cors, [], async () => {
      const o = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
      return o.CORSRules ?? [];
    }),
    read<unknown[]>(caps.lifecycle, [], async () => {
      const o = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
      return o.Rules ?? [];
    }),
    read<unknown | null>(caps.bucketPolicy, null, async () => {
      const o = await client.send(new GetBucketPolicyCommand({ Bucket: bucket }));
      return o.Policy ? (JSON.parse(o.Policy) as unknown) : null;
    }),
    read<BucketSettings['publicAccessBlock']['value']>(caps.publicAccessBlock, null, async () => {
      const o = await client.send(new GetPublicAccessBlockCommand({ Bucket: bucket }));
      const c = o.PublicAccessBlockConfiguration ?? {};
      return {
        BlockPublicAcls: !!c.BlockPublicAcls,
        IgnorePublicAcls: !!c.IgnorePublicAcls,
        BlockPublicPolicy: !!c.BlockPublicPolicy,
        RestrictPublicBuckets: !!c.RestrictPublicBuckets,
      };
    }),
    read<BucketSettings['encryption']['value']>(caps.encryption, null, async () => {
      const o = await client.send(new GetBucketEncryptionCommand({ Bucket: bucket }));
      const rule = o.ServerSideEncryptionConfiguration?.Rules?.[0];
      const d = rule?.ApplyServerSideEncryptionByDefault;
      return d?.SSEAlgorithm
        ? { algorithm: d.SSEAlgorithm, kmsKeyId: d.KMSMasterKeyID ?? null, bucketKeyEnabled: !!rule?.BucketKeyEnabled }
        : null;
    }),
    read<BucketSettings['objectLock']['value']>(caps.objectLock, null, async () => {
      const o = await client.send(new GetObjectLockConfigurationCommand({ Bucket: bucket }));
      const c = o.ObjectLockConfiguration;
      if (!c) return null;
      const r = c.Rule?.DefaultRetention;
      return { enabled: c.ObjectLockEnabled === 'Enabled', mode: r?.Mode ?? null, days: r?.Days ?? null, years: r?.Years ?? null };
    }),
  ]);
  return { region, versioning, cors, lifecycle, policy, publicAccessBlock, encryption, objectLock };
}

export async function setVersioning(client: S3Client, bucket: string, enabled: boolean) {
  await client.send(
    new PutBucketVersioningCommand({
      Bucket: bucket,
      VersioningConfiguration: { Status: enabled ? 'Enabled' : 'Suspended' },
    }),
  );
}

export async function setCors(client: S3Client, bucket: string, rules: unknown[]) {
  if (rules.length === 0) {
    await client.send(new DeleteBucketCorsCommand({ Bucket: bucket }));
    return;
  }
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: rules as NonNullable<PutBucketCorsCommandInput['CORSConfiguration']>['CORSRules'] },
    }),
  );
}

export async function setLifecycle(client: S3Client, bucket: string, rules: unknown[]) {
  if (rules.length === 0) {
    await client.send(new DeleteBucketLifecycleCommand({ Bucket: bucket }));
    return;
  }
  type Rules = NonNullable<PutBucketLifecycleConfigurationCommandInput['LifecycleConfiguration']>['Rules'];
  // The SDK expects Date objects for date fields.
  const normalized = (rules as Record<string, unknown>[]).map((r) => {
    const rule = structuredClone(r) as Record<string, unknown> & {
      Expiration?: { Date?: string | Date };
      Transitions?: { Date?: string | Date }[];
    };
    if (typeof rule.Expiration?.Date === 'string') rule.Expiration.Date = new Date(rule.Expiration.Date);
    for (const t of rule.Transitions ?? []) if (typeof t.Date === 'string') t.Date = new Date(t.Date);
    return rule;
  });
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: { Rules: normalized as unknown as Rules },
    }),
  );
}

export async function setPolicy(client: S3Client, bucket: string, policy: unknown | null) {
  if (policy === null) {
    await client.send(new DeleteBucketPolicyCommand({ Bucket: bucket }));
    return;
  }
  await client.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(policy) }));
}

export async function setPublicAccessBlock(
  client: S3Client,
  bucket: string,
  config: NonNullable<BucketSettings['publicAccessBlock']['value']> | null,
) {
  if (config === null) {
    await client.send(new DeletePublicAccessBlockCommand({ Bucket: bucket }));
    return;
  }
  await client.send(new PutPublicAccessBlockCommand({ Bucket: bucket, PublicAccessBlockConfiguration: config }));
}
