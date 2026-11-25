import type { S3Client } from '@aws-sdk/client-s3';
import type { UsageGroup, UsageResponse } from '../shared/types';
import { walkObjects } from './listing';

/** Lists every object under a prefix and adds up sizes by subfolder and storage class. */
export async function calculateUsage(
  client: S3Client,
  bucket: string,
  prefix: string,
  signal?: AbortSignal,
): Promise<UsageResponse> {
  const started = Date.now();
  const byFolder = new Map<string, UsageGroup>();
  const byClass = new Map<string, UsageGroup>();
  let objects = 0;
  let bytes = 0;

  const add = (map: Map<string, UsageGroup>, name: string, size: number) => {
    const g = map.get(name) ?? { name, objects: 0, bytes: 0 };
    g.objects++;
    g.bytes += size;
    map.set(name, g);
  };

  for await (const page of walkObjects(client, bucket, prefix, signal)) {
    for (const o of page) {
      const size = o.Size ?? 0;
      const rest = (o.Key as string).slice(prefix.length);
      const slash = rest.indexOf('/');
      objects++;
      bytes += size;
      add(byFolder, slash === -1 ? '(files in this folder)' : `${rest.slice(0, slash + 1)}`, size);
      add(byClass, o.StorageClass ?? 'STANDARD', size);
    }
  }

  const sorted = (m: Map<string, UsageGroup>) => [...m.values()].sort((a, b) => b.bytes - a.bytes);
  return {
    prefix,
    objects,
    bytes,
    byFolder: sorted(byFolder),
    byStorageClass: sorted(byClass),
    durationMs: Date.now() - started,
  };
}
