import { randomUUID } from 'node:crypto';
import type { JobInfo } from '../shared/types';
import { errorMessage } from '../s3/errors';
import type { SyncProgress } from '../s3/sync';

interface Job extends JobInfo {
  controller: AbortController;
}

const KEEP_FINISHED_MS = 24 * 60 * 60 * 1000;

/** Background jobs (sync) with live progress. In memory: they stop if s3deck restarts. */
export class JobRegistry {
  private jobs = new Map<string, Job>();

  start(owner: string, title: string, run: (signal: AbortSignal, progress: SyncProgress) => Promise<void>): JobInfo {
    this.sweep();
    const job: Job = {
      id: randomUUID(),
      type: 'sync',
      owner,
      title,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      total: 0,
      done: 0,
      bytesDone: 0,
      bytesTotal: 0,
      errors: [],
      controller: new AbortController(),
    };
    this.jobs.set(job.id, job);
    run(job.controller.signal, job)
      .then(() => {
        job.status = job.controller.signal.aborted ? 'cancelled' : 'done';
      })
      .catch((err: unknown) => {
        job.status = job.controller.signal.aborted ? 'cancelled' : 'failed';
        if (!job.controller.signal.aborted) job.errors.push({ key: '', message: errorMessage(err) });
      })
      .finally(() => {
        job.finishedAt = new Date().toISOString();
        if (job.errors.length > 500) job.errors.length = 500;
      });
    return this.info(job);
  }

  info(job: Job): JobInfo {
    const { controller: _c, ...rest } = job;
    return { ...rest, errors: rest.errors.slice(0, 100) };
  }

  list(owner: string | null): JobInfo[] {
    return [...this.jobs.values()]
      .filter((j) => owner === null || j.owner === owner)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((j) => this.info(j));
  }

  get(id: string, owner: string | null): JobInfo | null {
    const j = this.jobs.get(id);
    return j && (owner === null || j.owner === owner) ? this.info(j) : null;
  }

  cancel(id: string, owner: string | null): boolean {
    const j = this.jobs.get(id);
    if (!j || (owner !== null && j.owner !== owner) || j.status !== 'running') return false;
    j.controller.abort();
    return true;
  }

  private sweep() {
    const now = Date.now();
    for (const [id, j] of this.jobs) {
      if (j.finishedAt && now - Date.parse(j.finishedAt) > KEEP_FINISHED_MS) this.jobs.delete(id);
    }
  }
}
