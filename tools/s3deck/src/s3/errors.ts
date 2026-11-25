import { S3ServiceException } from '@aws-sdk/client-s3';

/** A request that can't be carried out as asked (maps to HTTP 400). */
export class UserError extends Error {
  override name = 'UserError';
}

/** Error codes that mean "this provider doesn't implement the feature". */
const UNSUPPORTED = new Set([
  'NotImplemented',
  'NotSupported',
  'XNotImplemented',
  'MethodNotAllowed',
  'UnsupportedOperation',
]);

/** Error codes that mean "the setting isn't configured" for bucket settings reads. */
const NOT_CONFIGURED = new Set([
  'NoSuchCORSConfiguration',
  'NoSuchLifecycleConfiguration',
  'NoSuchBucketPolicy',
  'NoSuchPublicAccessBlockConfiguration',
  'NoSuchTagSet',
  'NoSuchTagSetError',
  'ServerSideEncryptionConfigurationNotFoundError',
  'ObjectLockConfigurationNotFoundError',
  'NoSuchObjectLockConfiguration',
]);

export function errorCode(err: unknown): string {
  if (err instanceof S3ServiceException) return err.name;
  if (err && typeof err === 'object' && 'name' in err && typeof err.name === 'string') return err.name;
  return 'Error';
}

export function errorStatus(err: unknown): number | undefined {
  if (err instanceof S3ServiceException) return err.$metadata.httpStatusCode;
  return undefined;
}

export function isUnsupported(err: unknown): boolean {
  const status = errorStatus(err);
  return UNSUPPORTED.has(errorCode(err)) || status === 501;
}

export function isNotConfigured(err: unknown): boolean {
  return NOT_CONFIGURED.has(errorCode(err));
}

export function isNotFound(err: unknown): boolean {
  const code = errorCode(err);
  return code === 'NoSuchKey' || code === 'NotFound' || code === 'NoSuchVersion' || errorStatus(err) === 404;
}

export function isAccessDenied(err: unknown): boolean {
  return errorCode(err) === 'AccessDenied' || errorStatus(err) === 403;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    // HEAD responses have no body, so the SDK falls back to "UnknownError".
    if (err.message && err.message !== 'UnknownError') return err.message;
    const status = errorStatus(err);
    if (status === 403) return 'Access denied';
    if (status === 404) return 'Not found';
    return `${errorCode(err)}${status ? ` (HTTP ${status})` : ''}`;
  }
  return String(err);
}
