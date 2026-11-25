import { useSyncExternalStore } from 'react';
import { CSRF_HEADER, CSRF_VALUE } from '@shared/constants';
import { objectKeySchema } from '@shared/schemas';
import type { UploadPartInfo } from '@shared/types';
import { api, ApiError, apiUrl, bucketPath } from '@/api/client';

export type UploadStatus = 'queued' | 'uploading' | 'paused' | 'done' | 'error' | 'cancelled';

export interface UploadItem {
  id: string;
  bucket: string;
  key: string;
  file: File;
  /** Uploads keep going to the connection they started on, even if you switch. */
  connectionId: string;
  loaded: number;
  /** Bytes per second, smoothed. */
  speed: number;
  status: UploadStatus;
  error?: string;
  /** Picked up from a previous, interrupted upload. */
  resumed?: boolean;
}

export interface FileWithPath {
  file: File;
  /** Path relative to the drop target, e.g. "photos/2024/a.jpg". */
  path: string;
}

const FILE_CONCURRENCY = 3;
const PART_CONCURRENCY = 4;
/** Files above this go in parts and can resume. */
const MULTIPART_THRESHOLD = 16 * 1024 * 1024;
const MIN_PART = 8 * 1024 * 1024;
const MAX_ATTEMPTS = 5;
const CONN_HEADER = 'x-s3deck-connection';

/** Part size: at least 8 MiB, and few enough parts to stay under S3's 10,000 limit. */
export function partSizeFor(size: number): number {
  const mib = 1024 * 1024;
  return Math.max(MIN_PART, Math.ceil(size / 9000 / mib) * mib);
}

interface ResumeRecord {
  uploadId: string;
  partSize: number;
}

const storage = {
  key: (i: UploadItem) => `s3deck-upload:${i.connectionId}|${i.bucket}|${i.key}|${i.file.size}|${i.file.lastModified}`,
  get(i: UploadItem): ResumeRecord | null {
    try {
      const raw = localStorage.getItem(this.key(i));
      return raw ? (JSON.parse(raw) as ResumeRecord) : null;
    } catch {
      return null;
    }
  },
  set(i: UploadItem, r: ResumeRecord) {
    try {
      localStorage.setItem(this.key(i), JSON.stringify(r));
    } catch {
      // storage full or blocked: the upload still works, it just can't resume after a reload
    }
  },
  clear(i: UploadItem) {
    try {
      localStorage.removeItem(this.key(i));
    } catch {
      // ignore
    }
  },
};

class RetryableError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One XHR PUT with progress. Resolves with the response JSON. */
function put(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress: (loaded: number) => void,
  track: (x: XMLHttpRequest) => () => void,
) {
  return new Promise<unknown>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const untrack = track(xhr);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      untrack();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        // not JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(parsed);
      const message = (parsed as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${xhr.status}`;
      if (xhr.status >= 500 || xhr.status === 408 || xhr.status === 429) reject(new RetryableError(message));
      else reject(new Error(message));
    };
    xhr.onerror = () => (untrack(), reject(new RetryableError('Network error')));
    xhr.onabort = () => (untrack(), reject(new DOMException('Aborted', 'AbortError')));
    xhr.open('PUT', url);
    xhr.setRequestHeader(CSRF_HEADER, CSRF_VALUE);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.send(body);
  });
}

class UploadQueue {
  private items: UploadItem[] = [];
  private xhrs = new Map<string, Set<XMLHttpRequest>>();
  private stops = new Set<string>();
  private listeners = new Set<() => void>();
  private completeListeners = new Set<(bucket: string) => void>();
  private frame: number | null = null;
  private seq = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  getSnapshot = () => this.items;

  /** Called when an upload finishes, so listings can refresh. */
  onComplete(fn: (bucket: string) => void) {
    this.completeListeners.add(fn);
    return () => void this.completeListeners.delete(fn);
  }

  /** Queues files under a prefix. Returns the keys rejected by validation. */
  add(connectionId: string, bucket: string, prefix: string, files: FileWithPath[]): string[] {
    const rejected: string[] = [];
    const added: UploadItem[] = [];
    for (const f of files) {
      const key = prefix + f.path.replace(/^\/+/, '');
      if (!objectKeySchema.safeParse(key).success || key.endsWith('/')) {
        rejected.push(key);
        continue;
      }
      added.push({
        id: `u${++this.seq}`,
        bucket,
        key,
        file: f.file,
        connectionId,
        loaded: 0,
        speed: 0,
        status: 'queued',
      });
    }
    this.items = [...this.items, ...added];
    this.emit(true);
    this.pump();
    return rejected;
  }

  /** Stops an upload for good (and discards its uploaded parts). */
  cancel(id: string) {
    const item = this.items.find((i) => i.id === id);
    this.halt(id);
    this.update(id, { status: 'cancelled', speed: 0 }, true);
    if (item) {
      const rec = storage.get(item);
      if (rec) {
        storage.clear(item);
        void api(bucketPath(item.bucket, '/multipart/abort'), {
          method: 'POST',
          body: { key: item.key, uploadId: rec.uploadId },
          headers: { [CONN_HEADER]: item.connectionId },
        }).catch(() => {});
      }
    }
    this.pump();
  }

  /** Pauses a large upload; parts already sent are kept. */
  pause(id: string) {
    this.halt(id);
    this.update(id, { status: 'paused', speed: 0 }, true);
    this.pump();
  }

  resume(id: string) {
    this.update(id, { status: 'queued', error: undefined }, true);
    this.pump();
  }

  retry(id: string) {
    this.resume(id);
  }

  cancelAll() {
    for (const item of this.items) {
      if (item.status === 'queued' || item.status === 'uploading' || item.status === 'paused') this.cancel(item.id);
    }
  }

  clearFinished() {
    this.items = this.items.filter((i) => i.status === 'queued' || i.status === 'uploading' || i.status === 'paused');
    this.emit(true);
  }

  private halt(id: string) {
    this.stops.add(id);
    for (const x of this.xhrs.get(id) ?? []) x.abort();
  }

  private pump() {
    const active = this.items.filter((i) => i.status === 'uploading').length;
    const next = this.items.filter((i) => i.status === 'queued').slice(0, Math.max(0, FILE_CONCURRENCY - active));
    for (const item of next) void this.start(item);
  }

  private track(id: string) {
    return (x: XMLHttpRequest) => {
      const set = this.xhrs.get(id) ?? new Set();
      set.add(x);
      this.xhrs.set(id, set);
      return () => void set.delete(x);
    };
  }

  private async start(item: UploadItem) {
    this.stops.delete(item.id);
    this.update(item.id, { status: 'uploading', error: undefined }, true);
    const meter = this.speedMeter(item.id);
    try {
      if (item.file.size > MULTIPART_THRESHOLD) await this.uploadMultipart(item, meter);
      else await this.uploadSingle(item, meter);
      if (this.stops.has(item.id)) return;
      this.update(item.id, { status: 'done', loaded: item.file.size, speed: 0 }, true);
      for (const fn of this.completeListeners) fn(item.bucket);
    } catch (err) {
      if (this.stops.has(item.id) || (err instanceof DOMException && err.name === 'AbortError')) return;
      this.update(
        item.id,
        { status: 'error', error: err instanceof Error ? err.message : String(err), speed: 0 },
        true,
      );
    } finally {
      this.xhrs.delete(item.id);
      this.pump();
    }
  }

  /** Smooths speed from total progress. */
  private speedMeter(id: string) {
    let lastLoaded = 0;
    let lastTime = performance.now();
    let speed = 0;
    return (loaded: number) => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      if (dt > 0.3) {
        const instant = Math.max(0, (loaded - lastLoaded) / dt);
        speed = speed ? speed * 0.7 + instant * 0.3 : instant;
        lastLoaded = loaded;
        lastTime = now;
      }
      this.update(id, { loaded, speed });
    };
  }

  private async uploadSingle(item: UploadItem, report: (loaded: number) => void) {
    const url = apiUrl(bucketPath(item.bucket, '/upload'), { key: item.key, contentType: item.file.type || undefined });
    for (let attempt = 1; ; attempt++) {
      try {
        await put(
          url,
          item.file,
          { 'Content-Type': item.file.type || 'application/octet-stream', [CONN_HEADER]: item.connectionId },
          report,
          this.track(item.id),
        );
        return;
      } catch (err) {
        if (!(err instanceof RetryableError) || attempt >= MAX_ATTEMPTS || this.stops.has(item.id)) throw err;
        await sleep(1000 * 2 ** (attempt - 1));
      }
    }
  }

  private async uploadMultipart(item: UploadItem, report: (loaded: number) => void) {
    const headers = { [CONN_HEADER]: item.connectionId };
    const base = (path: string) => bucketPath(item.bucket, `/multipart${path}`);

    // Resume an earlier upload of this exact file, if S3 still has it.
    let record = storage.get(item);
    let done: UploadPartInfo[] = [];
    if (record) {
      try {
        done = (
          await api<{ parts: UploadPartInfo[] }>(base('/parts'), {
            query: { key: item.key, uploadId: record.uploadId },
            headers,
          })
        ).parts;
        this.update(item.id, { resumed: true });
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err;
        storage.clear(item);
        record = null;
      }
    }
    if (!record) {
      const created = await api<{ uploadId: string }>(base(''), {
        method: 'POST',
        body: { key: item.key, contentType: item.file.type || undefined },
        headers,
      });
      record = { uploadId: created.uploadId, partSize: partSizeFor(item.file.size) };
      storage.set(item, record);
    }

    const { uploadId, partSize } = record;
    const count = Math.ceil(item.file.size / partSize);
    const expected = (n: number) => (n === count ? item.file.size - (count - 1) * partSize : partSize);
    const etags = new Map<number, string>();
    for (const p of done) if (p.size === expected(p.partNumber)) etags.set(p.partNumber, p.etag);

    const inflight = new Map<number, number>();
    let completedBytes = [...etags.keys()].reduce((a, n) => a + expected(n), 0);
    const progress = () => report(completedBytes + [...inflight.values()].reduce((a, b) => a + b, 0));
    progress();

    const queue = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !etags.has(n));
    const worker = async () => {
      for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
        if (this.stops.has(item.id)) return;
        const start = (n - 1) * partSize;
        const blob = item.file.slice(start, start + expected(n));
        const url = apiUrl(base('/part'), { key: item.key, uploadId, partNumber: n });
        for (let attempt = 1; ; attempt++) {
          try {
            const res = (await put(
              url,
              blob,
              { 'Content-Type': 'application/octet-stream', ...headers },
              (l) => (inflight.set(n, l), progress()),
              this.track(item.id),
            )) as { etag: string };
            etags.set(n, res.etag);
            break;
          } catch (err) {
            inflight.delete(n);
            if (!(err instanceof RetryableError) || attempt >= MAX_ATTEMPTS || this.stops.has(item.id)) throw err;
            await sleep(1000 * 2 ** (attempt - 1));
          }
        }
        inflight.delete(n);
        completedBytes += expected(n);
        progress();
      }
    };
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, queue.length) }, worker));
    if (this.stops.has(item.id)) return;

    await api(base('/complete'), {
      method: 'POST',
      body: { key: item.key, uploadId, parts: [...etags].map(([PartNumber, ETag]) => ({ PartNumber, ETag })) },
      headers,
    });
    storage.clear(item);
  }

  private update(id: string, patch: Partial<UploadItem>, immediate = false) {
    this.items = this.items.map((i) => (i.id === id ? { ...i, ...patch } : i));
    this.emit(immediate);
  }

  /** Progress events are batched to one render per frame. */
  private emit(immediate: boolean) {
    if (immediate) {
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      this.frame = null;
      for (const fn of this.listeners) fn();
      return;
    }
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      for (const fn of this.listeners) fn();
    });
  }
}

export const uploadQueue = new UploadQueue();

export function useUploads() {
  return useSyncExternalStore(uploadQueue.subscribe, uploadQueue.getSnapshot);
}

/* ------------------------------------------------------------------ */
/* Reading dropped folders and pasted files                            */
/* ------------------------------------------------------------------ */

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function walk(entry: FileSystemEntry, out: FileWithPath[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, path: entry.fullPath.replace(/^\//, '') });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns results in chunks; keep reading until empty.
    for (;;) {
      const batch = await readEntries(reader);
      if (!batch.length) break;
      for (const e of batch) await walk(e, out);
    }
  }
}

/** Collects files from a drop, including whole folders. */
export async function filesFromDrop(dt: DataTransfer): Promise<FileWithPath[]> {
  const entries = [...dt.items]
    .filter((i) => i.kind === 'file')
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return [...dt.files].map((file) => ({ file, path: file.name }));
  const out: FileWithPath[] = [];
  for (const e of entries) await walk(e, out);
  return out;
}

export function filesFromInput(list: FileList | null): FileWithPath[] {
  return [...(list ?? [])].map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

/** Files from a paste. Screenshots arrive as "image.png", so they get a timestamped name. */
export function filesFromClipboard(data: DataTransfer | null): FileWithPath[] {
  const files = [...(data?.files ?? [])];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return files.map((file, i) => {
    const generic = /^image\.(png|jpe?g|gif|webp)$/i.test(file.name);
    const ext = file.name.split('.').pop() ?? 'bin';
    return { file, path: generic ? `pasted-${stamp}${files.length > 1 ? `-${i + 1}` : ''}.${ext}` : file.name };
  });
}
