/**
 * Row serializers shared by the server (streaming "all rows" exports) and the
 * browser (exporting the current page, a selection, or SQL results), so every
 * path produces byte-identical files. Pure functions, no runtime imports.
 */
import type { Cell } from './types.js';

export const EXPORT_FORMATS = ['csv', 'csv-excel', 'tsv', 'json', 'ndjson', 'sql', 'markdown'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_META: Record<ExportFormat, { label: string; ext: string; mime: string; hint: string }> = {
  csv: { label: 'CSV', ext: 'csv', mime: 'text/csv', hint: 'Comma-separated, RFC 4180' },
  'csv-excel': { label: 'CSV for Excel', ext: 'csv', mime: 'text/csv', hint: 'UTF-8 with BOM, CRLF line endings' },
  tsv: { label: 'TSV', ext: 'tsv', mime: 'text/tab-separated-values', hint: 'Postgres text format, NULL as \\N' },
  json: { label: 'JSON', ext: 'json', mime: 'application/json', hint: 'Array of objects, typed values' },
  ndjson: { label: 'JSON Lines', ext: 'ndjson', mime: 'application/x-ndjson', hint: 'One object per line' },
  sql: { label: 'SQL INSERT', ext: 'sql', mime: 'application/sql', hint: 'INSERT statements for this table' },
  markdown: { label: 'Markdown', ext: 'md', mime: 'text/markdown', hint: 'Table for docs and issues' },
};

export interface ExportColumn {
  name: string;
  /** pg type name (int4, bool, jsonb, …) when known; enables typed JSON / SQL output. */
  typeName?: string;
}

export interface Serializer {
  header(): string;
  row(cells: Cell[], index: number): string;
  footer(): string;
}

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

const NUMERIC = new Set(['int2', 'int4', 'int8', 'float4', 'float8', 'numeric', 'oid']);

/** Raw Postgres text → a JSON value, without losing precision. */
function typed(v: Cell, typeName?: string): unknown {
  if (v === null) return null;
  if (typeName === 'bool') return v === 't' || v === 'true';
  if (typeName === 'json' || typeName === 'jsonb') {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  if (typeName && NUMERIC.has(typeName)) {
    const n = Number(v);
    // Keep as a string if converting would change it (big ints, trailing zeros, NaN…).
    return Number.isFinite(n) && String(n) === v ? n : v;
  }
  return v;
}

function sqlLiteral(v: Cell, typeName?: string): string {
  if (v === null) return 'NULL';
  if (typeName === 'bool') return v === 't' || v === 'true' ? 'true' : 'false';
  if (typeName && NUMERIC.has(typeName) && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v)) return v;
  return `'${v.replace(/'/g, "''")}'`;
}

const csvCell = (v: Cell, sep: string) => {
  if (v === null) return '';
  return v === '' || v.includes(sep) || /["\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

/** Postgres COPY text format escaping. */
const tsvCell = (v: Cell) =>
  v === null ? '\\N' : v.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

const mdCell = (v: Cell) => (v === null ? '_NULL_' : v.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>'));

/**
 * @param target Qualified table for SQL INSERT output, e.g. { schema: 'public', table: 'users' }.
 */
export function createSerializer(
  format: ExportFormat,
  columns: ExportColumn[],
  target?: { schema: string; table: string },
): Serializer {
  const names = columns.map((c) => c.name);
  const obj = (cells: Cell[]) =>
    Object.fromEntries(columns.map((c, i) => [c.name, typed(cells[i] ?? null, c.typeName)]));

  switch (format) {
    case 'csv':
    case 'csv-excel': {
      const nl = format === 'csv-excel' ? '\r\n' : '\n';
      const line = (cells: Cell[]) => cells.map((v) => csvCell(v, ',')).join(',') + nl;
      return {
        // An empty string is quoted ("") so it stays distinct from NULL (empty, unquoted).
        header: () => (format === 'csv-excel' ? '﻿' : '') + names.map((n) => csvCell(n, ',')).join(',') + nl,
        row: line,
        footer: () => '',
      };
    }
    case 'tsv':
      return {
        header: () => names.map(tsvCell).join('\t') + '\n',
        row: (cells) => cells.map(tsvCell).join('\t') + '\n',
        footer: () => '',
      };
    case 'json':
      return {
        header: () => '[\n',
        row: (cells, i) => (i ? ',\n' : '') + '  ' + JSON.stringify(obj(cells)),
        footer: () => '\n]\n',
      };
    case 'ndjson':
      return { header: () => '', row: (cells) => JSON.stringify(obj(cells)) + '\n', footer: () => '' };
    case 'sql': {
      const rel = target ? `${quoteIdent(target.schema)}.${quoteIdent(target.table)}` : quoteIdent('query_result');
      const cols = names.map(quoteIdent).join(', ');
      return {
        header: () => '',
        row: (cells) =>
          `INSERT INTO ${rel} (${cols}) VALUES (${cells.map((v, i) => sqlLiteral(v, columns[i]?.typeName)).join(', ')});\n`,
        footer: () => '',
      };
    }
    case 'markdown':
      return {
        header: () => `| ${names.map(mdCell).join(' | ')} |\n| ${names.map(() => '---').join(' | ')} |\n`,
        row: (cells) => `| ${cells.map(mdCell).join(' | ')} |\n`,
        footer: () => '',
      };
  }
}

/** Serialize rows already in memory. */
export function serializeAll(
  format: ExportFormat,
  columns: ExportColumn[],
  rows: Cell[][],
  target?: { schema: string; table: string },
): string {
  const s = createSerializer(format, columns, target);
  return s.header() + rows.map((r, i) => s.row(r, i)).join('') + s.footer();
}

/* ---------------------------------------------------------------- */
/* Import                                                            */
/* ---------------------------------------------------------------- */

export const IMPORT_FORMATS = ['csv', 'tsv', 'ndjson'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export interface ImportResponse {
  rowCount: number;
  ms: number;
  bytes: number;
}

export interface RestoreResponse {
  /** SQL statements executed. */
  statements: number;
  /** Statements skipped (ownership/privileges, unknown settings). */
  skipped: number;
  /** COPY blocks loaded, and rows they contained. */
  copies: number;
  rows: number;
  ms: number;
  bytes: number;
}
