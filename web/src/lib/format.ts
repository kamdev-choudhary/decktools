import type { Cell } from '@shared/types';

const nf = new Intl.NumberFormat();
export const formatNumber = (n: number) => nf.format(n);

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
  const blob = new Blob([toCsv(fields, rows)], { type: 'text/csv;charset=utf-8' });
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
