import { appendFile, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ActivityEntry } from '../../shared/types';
import { ensureDir } from './files';

const MAX_MEMORY = 2000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Append-only log of changes (activity.jsonl, rotated at 10 MB) plus the latest entries in memory. */
export class ActivityLog {
  private recent: ActivityEntry[] = [];
  private seq = 0;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string | null) {}

  /** Loads the most recent entries from disk, so the log survives restarts. */
  async load() {
    if (!this.dataDir) return;
    const lines: string[] = [];
    for (const name of ['activity.jsonl.1', 'activity.jsonl']) {
      try {
        lines.push(...(await readFile(path.join(this.dataDir, name), 'utf8')).split('\n').filter(Boolean));
      } catch {
        // file doesn't exist yet
      }
    }
    const entries: ActivityEntry[] = [];
    for (const line of lines.slice(-MAX_MEMORY)) {
      try {
        entries.push(JSON.parse(line) as ActivityEntry);
      } catch {
        // skip a corrupt line
      }
    }
    this.recent = entries.reverse();
  }

  record(entry: Omit<ActivityEntry, 'id' | 'at'>) {
    const full: ActivityEntry = {
      id: `${Date.now().toString(36)}-${(++this.seq).toString(36)}`,
      at: new Date().toISOString(),
      ...entry,
    };
    this.recent.unshift(full);
    if (this.recent.length > MAX_MEMORY) this.recent.length = MAX_MEMORY;
    if (this.dataDir) {
      const dir = this.dataDir;
      this.writing = this.writing.then(() => this.append(dir, full)).catch(() => {});
    }
  }

  private async append(dir: string, entry: ActivityEntry) {
    const file = path.join(dir, 'activity.jsonl');
    await ensureDir(dir);
    try {
      if ((await stat(file)).size > MAX_FILE_BYTES) await rename(file, `${file}.1`);
    } catch {
      // no file yet
    }
    await appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  }

  list(filter: { user?: string; bucket?: string; limit: number }): ActivityEntry[] {
    return this.recent
      .filter((e) => (!filter.user || e.user === filter.user) && (!filter.bucket || e.bucket === filter.bucket))
      .slice(0, filter.limit);
  }
}
