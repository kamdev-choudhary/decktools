import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import { errorCode, errorMessage, errorStatus, UserError } from '../s3/errors';
import { formatZodError } from '../shared/schemas';
import type { ApiErrorBody } from '../shared/types';

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Storage credential failures use 400, so the UI never mistakes them for an expired s3deck login (401).
const S3_STATUS: Record<string, ContentfulStatusCode> = {
  NoSuchBucket: 404,
  NoSuchKey: 404,
  NoSuchVersion: 404,
  NotFound: 404,
  AccessDenied: 403,
  InvalidAccessKeyId: 400,
  SignatureDoesNotMatch: 400,
  ExpiredToken: 400,
  BucketNotEmpty: 409,
  BucketAlreadyExists: 409,
  BucketAlreadyOwnedByYou: 409,
  InvalidBucketName: 400,
  InvalidArgument: 400,
  InvalidRequest: 400,
  MalformedXML: 400,
  MalformedPolicy: 400,
  NotImplemented: 501,
  InvalidObjectState: 409,
  NoSuchUpload: 404,
  EntityTooSmall: 400,
  InvalidPart: 400,
};

export function toErrorResponse(err: unknown): { status: ContentfulStatusCode; body: ApiErrorBody } {
  if (err instanceof HttpError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message } } };
  }
  if (err instanceof UserError) {
    return { status: 400, body: { error: { code: 'BAD_REQUEST', message: err.message } } };
  }
  if (err instanceof ZodError) {
    return { status: 400, body: { error: { code: 'VALIDATION', message: formatZodError(err) } } };
  }
  if (err instanceof Error && err.name === 'CredentialsProviderError') {
    return { status: 400, body: { error: { code: 'CREDENTIALS', message: err.message } } };
  }
  const code = errorCode(err);
  const httpStatus = errorStatus(err);
  if (httpStatus || code in S3_STATUS) {
    let status =
      S3_STATUS[code] ??
      (httpStatus && httpStatus >= 400 && httpStatus < 600 ? (httpStatus as ContentfulStatusCode) : 502);
    if (status === 401) status = 400;
    return { status, body: { error: { code, message: errorMessage(err) } } };
  }
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return {
      status: 499 as ContentfulStatusCode,
      body: { error: { code: 'ABORTED', message: 'Request was cancelled' } },
    };
  }
  // Network-level failures talking to the endpoint (ECONNREFUSED, DNS, TLS…)
  const sysCode = (err as { code?: string } | null)?.code;
  if (sysCode && /^E[A-Z]+$/.test(sysCode)) {
    return {
      status: 502,
      body: { error: { code: sysCode, message: `Can't reach the storage endpoint (${sysCode})` } },
    };
  }
  return { status: 500, body: { error: { code: 'INTERNAL', message: errorMessage(err) } } };
}

export function onError(err: unknown, c: Context) {
  const { status, body } = toErrorResponse(err);
  if (status >= 500 && status !== 501) console.error(`  ${c.req.method} ${c.req.path} failed:`, err);
  return c.json(body, status);
}
