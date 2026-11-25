import { formatBytes, formatDuration } from '@/lib/format';

export interface Progress {
  loaded: number;
  total: number;
  startedAt: number;
  /** performance.now() when this progress was reported. */
  at: number;
}

/** Progress bar with bytes, speed and time left for an upload. */
export function UploadProgress({ progress }: { progress: Progress }) {
  const pct = Math.min(progress.loaded / Math.max(progress.total, 1), 1);
  const elapsed = (progress.at - progress.startedAt) / 1000;
  const speed = elapsed > 0.5 ? progress.loaded / elapsed : 0;
  const eta = speed > 0 ? (progress.total - progress.loaded) / speed : null;

  return (
    <div className="space-y-1.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground transition-[width] duration-300" style={{ width: `${pct * 100}%` }} />
      </div>
      <div className="flex justify-between gap-3 text-xs text-muted-foreground tabular-nums">
        <span>
          {pct >= 1 ? 'Uploaded. Waiting for Postgres to finish…' : `${formatBytes(progress.loaded)} of ${formatBytes(progress.total)}`}
        </span>
        <span>
          {speed > 0 && pct < 1 && `${formatBytes(speed)}/s`}
          {eta !== null && pct < 1 && ` · ${eta < 60 ? `${Math.ceil(eta)}s` : formatDuration(eta)} left`}
        </span>
      </div>
    </div>
  );
}
