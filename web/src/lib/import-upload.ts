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
 * POST a file to /import with XMLHttpRequest (fetch can't report upload
 * progress). The browser streams the File from disk, so size doesn't matter.
 */
export function uploadImport(
  db: string,
  file: File,
  params: URLSearchParams,
  onProgress: (loaded: number, total: number) => void,
): { promise: Promise<ImportResponse>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<ImportResponse>((resolve, reject) => {
    xhr.open('POST', `${BASE}api/db/${encodeURIComponent(db)}/import?${params}`);
    xhr.setRequestHeader('x-pgdeck', '1');
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => onProgress(e.loaded, e.total || file.size);
    xhr.onload = () => {
      let body: ImportResponse | ApiErrorBody;
      try {
        body = JSON.parse(xhr.responseText) as ImportResponse | ApiErrorBody;
      } catch {
        body = { error: `${xhr.status} ${xhr.statusText}` };
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as ImportResponse);
      else reject(new ApiError(body as ApiErrorBody, xhr.status));
    };
    xhr.onerror = () => reject(new Error('Network error during upload. Nothing was imported.'));
    xhr.onabort = () => reject(new UploadCancelled());
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
