import { S3Client } from '@aws-sdk/client-s3';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { detectProvider } from '../s3/provider';
import { DEFAULT_REGION } from '../shared/constants';
import type { ConnectionSpec } from '../server/connections';
import type { CliOptions } from './options';

export interface ResolvedStartup {
  spec: ConnectionSpec | null;
  /** Why no credentials were found, when spec is null. */
  reason?: string;
}

/** Region from --region / AWS_REGION, then the profile's config file, then the provider default. */
async function resolveRegion(opts: CliOptions): Promise<string> {
  if (opts.region) return opts.region;
  if (process.env.AWS_DEFAULT_REGION) return process.env.AWS_DEFAULT_REGION;
  const provider = detectProvider(opts.endpoint);
  if (provider.defaultRegion) return provider.defaultRegion;
  try {
    const probe = new S3Client({ profile: opts.profile });
    const region = await probe.config.region();
    probe.destroy();
    if (region) return region;
  } catch {
    // no region configured anywhere
  }
  return DEFAULT_REGION;
}

/**
 * Credentials, in order: --access-key/--secret-key, AWS_* env vars, a profile from
 * ~/.aws (incl. SSO and assumed roles), then instance/container/web identity.
 */
export async function resolveStartupConnection(opts: CliOptions): Promise<ResolvedStartup> {
  if (!!opts.accessKey !== !!opts.secretKey) {
    throw new Error('--access-key and --secret-key must be used together');
  }
  const region = await resolveRegion(opts);
  const base = {
    source: 'cli' as const,
    endpoint: opts.endpoint ?? null,
    region,
    pathStyle: opts.pathStyle === undefined ? ('auto' as const) : ('path' as const),
    pinnedBuckets: opts.bucket,
  };

  if (opts.accessKey && opts.secretKey) {
    return {
      spec: {
        ...base,
        accessKeyId: opts.accessKey,
        credentials: { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey, sessionToken: opts.sessionToken },
      },
    };
  }

  const provider = fromNodeProviderChain({ profile: opts.profile });
  try {
    const creds = await provider();
    return { spec: { ...base, accessKeyId: creds.accessKeyId, credentials: provider } };
  } catch (err) {
    return { spec: null, reason: err instanceof Error ? err.message.split('\n')[0] : String(err) };
  }
}
