import { CSRF_HEADER, CSRF_VALUE } from '@shared/constants';
import type { ApiErrorBody } from '@shared/types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

/** API URLs are relative to the page, so they work under any base path. */
export function apiUrl(path: string, query?: Query): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return `api/${path.replace(/^\//, '')}${s ? `?${s}` : ''}`;
}

export function bucketPath(bucket: string, rest = ''): string {
  return `buckets/${encodeURIComponent(bucket)}${rest}`;
}

let onUnauthenticated: (() => void) | null = null;
export function setUnauthenticatedHandler(fn: () => void) {
  onUnauthenticated = fn;
}

export async function readError(res: Response): Promise<ApiError> {
  let code = 'HTTP_ERROR';
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as ApiErrorBody;
    code = body.error.code;
    message = body.error.message;
  } catch {
    // not JSON
  }
  return new ApiError(res.status, code, message);
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Query; signal?: AbortSignal; headers?: Record<string, string> } = {},
): Promise<T> {
  const method = opts.method ?? 'GET';
  const res = await fetch(apiUrl(path, opts.query), {
    method,
    signal: opts.signal,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      [CSRF_HEADER]: CSRF_VALUE,
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await readError(res);
    if (err.status === 401 && err.code === 'UNAUTHENTICATED') onUnauthenticated?.();
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function downloadUrl(bucket: string, key: string, opts: { versionId?: string | null; inline?: boolean } = {}) {
  return apiUrl(bucketPath(bucket, '/download'), {
    key,
    versionId: opts.versionId ?? undefined,
    inline: opts.inline ? '1' : undefined,
  });
}

/** Starts a browser download without leaving the page. */
export function triggerDownload(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
