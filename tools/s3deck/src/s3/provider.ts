import type { Capabilities, ProviderId } from '../shared/types';

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Region to use when the user didn't give one. */
  defaultRegion?: string;
  /** Whether path-style URLs should be used when set to "auto". */
  pathStyle: boolean;
  capabilities: Capabilities;
}

export const AWS_STORAGE_CLASSES = [
  'STANDARD',
  'INTELLIGENT_TIERING',
  'STANDARD_IA',
  'ONEZONE_IA',
  'GLACIER_IR',
  'GLACIER',
  'DEEP_ARCHIVE',
];

/** Classes whose objects must be restored before they can be read. */
export const ARCHIVE_CLASSES = new Set(['GLACIER', 'DEEP_ARCHIVE']);

const ALL: Capabilities = {
  versioning: true,
  tagging: true,
  bucketPolicy: true,
  publicAccessBlock: true,
  lifecycle: true,
  cors: true,
  bucketCreate: true,
  storageClasses: AWS_STORAGE_CLASSES,
  archiveRestore: true,
  objectLock: true,
  encryption: true,
};

const NO_AWS_EXTRAS: Capabilities = { ...ALL, publicAccessBlock: false, storageClasses: [], archiveRestore: false };

/** Guesses the provider from the endpoint URL. Unknown endpoints use path-style URLs. */
export function detectProvider(endpoint?: string | null): ProviderInfo {
  if (!endpoint) {
    return { id: 'aws', name: 'AWS S3', pathStyle: false, capabilities: ALL };
  }
  const host = new URL(endpoint).hostname.toLowerCase();

  if (host.endsWith('.amazonaws.com')) {
    return { id: 'aws', name: 'AWS S3', pathStyle: false, capabilities: ALL };
  }
  if (host.endsWith('.r2.cloudflarestorage.com')) {
    return {
      id: 'r2',
      name: 'Cloudflare R2',
      defaultRegion: 'auto',
      pathStyle: true,
      capabilities: {
        ...ALL,
        versioning: false,
        tagging: false,
        bucketPolicy: false,
        publicAccessBlock: false,
        storageClasses: ['STANDARD', 'STANDARD_IA'],
        archiveRestore: false,
        objectLock: false,
        encryption: false,
      },
    };
  }
  if (host.endsWith('.backblazeb2.com')) {
    return {
      id: 'b2',
      name: 'Backblaze B2',
      defaultRegion: host.match(/^s3\.([a-z0-9-]+)\./)?.[1],
      pathStyle: false,
      capabilities: { ...NO_AWS_EXTRAS, bucketPolicy: false, tagging: false },
    };
  }
  if (host.endsWith('.digitaloceanspaces.com')) {
    return {
      id: 'spaces',
      name: 'DigitalOcean Spaces',
      defaultRegion: host.split('.')[0],
      pathStyle: false,
      capabilities: NO_AWS_EXTRAS,
    };
  }
  if (host.endsWith('.wasabisys.com')) {
    return {
      id: 'wasabi',
      name: 'Wasabi',
      defaultRegion: host.match(/^s3\.([a-z0-9-]+)\./)?.[1],
      pathStyle: false,
      capabilities: NO_AWS_EXTRAS,
    };
  }
  if (host === 'storage.googleapis.com') {
    return {
      id: 'gcs',
      name: 'Google Cloud Storage',
      defaultRegion: 'auto',
      pathStyle: true,
      capabilities: NO_AWS_EXTRAS,
    };
  }
  return {
    id: 'other',
    name: 'S3-compatible',
    // MinIO, Ceph, Garage, LocalStack… mostly need path-style URLs.
    pathStyle: true,
    capabilities: NO_AWS_EXTRAS,
  };
}

/** Refines the provider once we've seen a response (MinIO identifies itself in the Server header). */
export function refineProvider(info: ProviderInfo, serverHeader: string | undefined): ProviderInfo {
  if (info.id === 'other' && serverHeader?.toLowerCase().includes('minio')) {
    return { ...info, id: 'minio', name: 'MinIO', capabilities: { ...NO_AWS_EXTRAS } };
  }
  return info;
}
