import type { ImportFormat } from '@shared/export';

/** What the import dialog learns from the first few KB of a file. */
export interface FilePreview {
  /** Column names (from the header, JSON keys, or "column 1…"). */
  columns: string[];
  /** A few sample rows, aligned with `columns`. */
  rows: (string | null)[][];
}

const PREVIEW_BYTES = 256 * 1024;
const SAMPLE_ROWS = 5;

/** Guess format and compression from the file name. */
export function detectFormat(name: string): { format: ImportFormat; gzip: boolean } {
  const lower = name.toLowerCase();
  const gzip = lower.endsWith('.gz');
  const base = gzip ? lower.slice(0, -3) : lower;
  const format: ImportFormat = /\.(ndjson|jsonl|json)$/.test(base)
    ? 'ndjson'
    : /\.(tsv|tab)$/.test(base)
      ? 'tsv'
      : 'csv';
  return { format, gzip };
}

/** Read the start of the file as text, decompressing gzip in the browser. */
export async function readHead(file: File, gzip: boolean): Promise<string> {
  if (!gzip) return file.slice(0, PREVIEW_BYTES).text();
  const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < PREVIEW_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

/** Pick the most likely delimiter from the first line. */
export function sniffDelimiter(text: string): string {
  const nl = text.indexOf('\n');
  const first = nl === -1 ? text : text.slice(0, nl);
  const candidates = [',', ';', '\t', '|'];
  return candidates.reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ',');
}

/** Minimal RFC 4180 parser for previews: handles quotes, escaped quotes and quoted newlines. */
function parseCsv(text: string, delimiter: string, maxRecords: number): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < text.length && out.length < maxRecords) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      out.push(row);
      row = [];
      field = '';
    } else field += ch;
    i++;
  }
  // The last record is only trusted if the whole file fit in the preview.
  if (i >= text.length && (field || row.length) && out.length < maxRecords) out.push([...row, field]);
  return out;
}

const tsvUnescape = (v: string): string | null =>
  v === '\\N' ? null : v.replace(/\\(.)/g, (_, c: string) => ({ t: '\t', n: '\n', r: '\r', '\\': '\\' })[c] ?? c);

export function buildPreview(text: string, format: ImportFormat, delimiter: string, header: boolean): FilePreview {
  const clean = text.replace(/^﻿/, '');

  if (format === 'ndjson') {
    const objects: Record<string, unknown>[] = [];
    for (const line of clean.split('\n')) {
      if (objects.length >= SAMPLE_ROWS) break;
      const t = line.trim();
      if (!t) continue;
      try {
        const o = JSON.parse(t) as unknown;
        if (o && typeof o === 'object' && !Array.isArray(o)) objects.push(o as Record<string, unknown>);
      } catch {
        // A partial last line in the preview window; ignore.
      }
    }
    const columns = [...new Set(objects.flatMap((o) => Object.keys(o)))];
    const show = (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return { columns, rows: objects.map((o) => columns.map((c) => show(o[c]))) };
  }

  const records =
    format === 'tsv'
      ? clean
          .split('\n')
          .slice(0, SAMPLE_ROWS + 1)
          .filter((l, i, all) => l !== '' || i < all.length - 1)
          .map((l) => l.replace(/\r$/, '').split('\t'))
      : parseCsv(clean, delimiter, SAMPLE_ROWS + 1);

  const width = Math.max(0, ...records.map((r) => r.length));
  const columns =
    header && records[0]
      ? records[0].map((c, i) => c.trim() || `column ${i + 1}`)
      : Array.from({ length: width }, (_, i) => `column ${i + 1}`);
  const body = (header ? records.slice(1) : records).slice(0, SAMPLE_ROWS);
  const cell = (v: string | undefined) =>
    v === undefined ? null : format === 'tsv' ? tsvUnescape(v) : v === '' ? null : v;
  return { columns, rows: body.map((r) => columns.map((_, i) => cell(r[i]))) };
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.]/g, '');

/** Match file columns to table columns by name (case/underscore-insensitive), else by position. */
export function autoMap(fileColumns: string[], tableColumns: string[], byPosition: boolean): string[] {
  const used = new Set<string>();
  return fileColumns.map((fc, i) => {
    const byName = tableColumns.find((tc) => !used.has(tc) && norm(tc) === norm(fc));
    const pick = byName ?? (byPosition ? tableColumns[i] : undefined);
    if (pick && !used.has(pick)) {
      used.add(pick);
      return pick;
    }
    return '';
  });
}
