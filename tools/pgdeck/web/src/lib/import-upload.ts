import type { ImportResponse } from '@shared/export';
import type { ApiErrorBody } from '@shared/types';
import { ApiError, BASE } from '@/api/client';

export class UploadCancelled extends Error {
  constructor() {
    super('Import cancelled. Nothing was imported.');
    this.name = 'UploadCancelled';
  }
}

/**
 * POST a file to a per-database endpoint (/import, /restore) with
 * XMLHttpRequest, since fetch can't report upload progress. The browser
 * streams the File from disk, so size doesn't matter.
 */
export function uploadFile<T>(
  db: string,
  endpoint: 'import' | 'restore',
  file: File,
  params: URLSearchParams,
  onProgress: (loaded: number, total: number) => void,
): { promise: Promise<T>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open('POST', `${BASE}api/db/${encodeURIComponent(db)}/${endpoint}?${params}`);
    xhr.setRequestHeader('x-pgdeck', '1');
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => onProgress(e.loaded, e.total || file.size);
    xhr.onload = () => {
      let body: T | ApiErrorBody;
      try {
        body = JSON.parse(xhr.responseText) as T | ApiErrorBody;
      } catch {
        body = { error: `${xhr.status} ${xhr.statusText}` };
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new ApiError(body as ApiErrorBody, xhr.status));
    };
    xhr.onerror = () => reject(new Error('Network error during upload. Nothing was imported.'));
    xhr.onabort = () => reject(new UploadCancelled());
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

/** Table import (COPY into one table). */
export const uploadImport = (
  db: string,
  file: File,
  params: URLSearchParams,
  onProgress: (loaded: number, total: number) => void,
) => uploadFile<ImportResponse>(db, 'import', file, params, onProgress);
