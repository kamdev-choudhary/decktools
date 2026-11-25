import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import type { PathStyle } from '../shared/schemas';
import { detectProvider, type ProviderInfo } from './provider';

export interface ClientConfig {
  endpoint?: string | null;
  region: string;
  pathStyle: PathStyle;
  credentials: NonNullable<S3ClientConfig['credentials']>;
}

export interface S3Handle {
  client: S3Client;
  provider: ProviderInfo;
  forcePathStyle: boolean;
  /** Last "Server" response header seen, used to detect MinIO. */
  serverHeader: () => string | undefined;
}

export function createS3Client(config: ClientConfig): S3Handle {
  const provider = detectProvider(config.endpoint);
  const forcePathStyle = config.pathStyle === 'auto' ? provider.pathStyle : config.pathStyle === 'path';

  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint || undefined,
    forcePathStyle,
    credentials: config.credentials,
    // Buckets in other AWS regions answer with a redirect; follow it transparently.
    followRegionRedirects: provider.id === 'aws',
    // Many S3-compatible services reject the newer default checksums.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 3,
  });

  let server: string | undefined;
  client.middlewareStack.add(
    (next) => async (args) => {
      const result = await next(args);
      const headers = (result.response as { headers?: Record<string, string> } | undefined)?.headers;
      if (headers?.server) server = headers.server;
      return result;
    },
    { step: 'deserialize', name: 's3deckServerHeader' },
  );

  return { client, provider, forcePathStyle, serverHeader: () => server };
}

/** Encodes a key for the x-amz-copy-source header. */
export function copySource(bucket: string, key: string, versionId?: string): string {
  const path = `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  return versionId ? `${path}?versionId=${encodeURIComponent(versionId)}` : path;
}

/**
 * Direct (unsigned) URL of an object, or under a custom public domain.
 * Returns null when the provider's S3 endpoint never serves unsigned reads
 * (Cloudflare R2: public objects are only reachable via r2.dev or a custom domain).
 */
export function publicObjectUrl(opts: {
  bucket: string;
  key: string;
  endpoint?: string | null;
  region: string;
  forcePathStyle: boolean;
  publicUrlBase?: string | null;
  providerId?: string;
}): string | null {
  const encodedKey = opts.key.split('/').map(encodeURIComponent).join('/');
  if (opts.publicUrlBase) return `${opts.publicUrlBase.replace(/\/+$/, '')}/${encodedKey}`;
  if (opts.providerId === 'r2') return null;
  if (!opts.endpoint) {
    const host = opts.region === 'us-east-1' ? 's3.amazonaws.com' : `s3.${opts.region}.amazonaws.com`;
    return opts.forcePathStyle || opts.bucket.includes('.')
      ? `https://${host}/${opts.bucket}/${encodedKey}`
      : `https://${opts.bucket}.${host}/${encodedKey}`;
  }
  const u = new URL(opts.endpoint);
  const base = u.pathname.replace(/\/+$/, '');
  if (opts.forcePathStyle) return `${u.origin}${base}/${opts.bucket}/${encodedKey}`;
  return `${u.protocol}//${opts.bucket}.${u.host}${base}/${encodedKey}`;
}
