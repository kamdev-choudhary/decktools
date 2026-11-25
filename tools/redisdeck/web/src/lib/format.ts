const nf = new Intl.NumberFormat();
export const formatNumber = (n: number) => nf.format(n);

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
export const formatCompact = (n: number) => compact.format(n);

/** 16651967 → "15.9 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB', 'TB', 'PB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** 7753 → "2h 9m", 300000 → "3d 11h", 42 → "42s" */
export function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

/** A PTTL in ms → "No expiry" / "Expires in 2h 9m". */
export const formatTtl = (ms: number) => (ms < 0 ? 'No expiry' : `Expires in ${formatDuration(Math.max(ms / 1000, 0))}`);

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function formatRelative(ms: number): string {
  const diff = (ms - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, secs] of steps) if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  return 'just now';
}
