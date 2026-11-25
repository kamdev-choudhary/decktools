import type { Cell } from '@shared/types';

const nf = new Intl.NumberFormat();
export const formatNumber = (n: number) => nf.format(n);

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
/** 14381 → "14.4K" */
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

export const formatPercent = (ratio: number, digits = 1) => `${(ratio * 100).toFixed(digits)}%`;

/** 7753 → "2h 9m", 300000 → "3d 11h" */
export function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${Math.max(m, 1)}m`;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
/** ISO timestamp → "3 days ago" */
export function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, secs] of steps) {
    if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  }
  return 'just now';
}

const NUMERIC_TYPE = /^(smallint|integer|bigint|numeric|decimal|real|double precision|money|oid)\b/;
export const isNumericType = (type: string | undefined) => !!type && NUMERIC_TYPE.test(type);

export function toCsv(fields: string[], rows: Cell[][]): string {
  const esc = (v: Cell) => {
    if (v === null) return '';
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return [fields.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

export function downloadCsv(filename: string, fields: string[], rows: Cell[][]): void {
  downloadText(filename, toCsv(fields, rows), 'text/csv');
}

/** Save text as a file in the browser. */
export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 1-based character offset → line/column, for Postgres error positions. */
export function lineCol(text: string, position: number): { line: number; col: number } {
  const before = text.slice(0, Math.max(position - 1, 0));
  const lines = before.split('\n');
  return { line: lines.length, col: lines[lines.length - 1]!.length + 1 };
}
