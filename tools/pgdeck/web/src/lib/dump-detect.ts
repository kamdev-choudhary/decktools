import { readHead } from './file-preview';

export type FileKind = 'table' | 'dump-sql' | 'dump-custom';

export interface DumpInfo {
  /** Tables seen in the first part of the file (CREATE TABLE / COPY). */
  tables: string[];
  /** The preview didn't cover the whole file, so there may be more. */
  partial: boolean;
  /** "pg_dump 18.6", "pgdeck", … when the header says so. */
  source: string | null;
}

export interface Detection {
  kind: FileKind;
  gzip: boolean;
  dump?: DumpInfo;
}

const PREVIEW = 256 * 1024;

async function firstBytes(file: File, n: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, n).arrayBuffer());
}

const unquote = (s: string) => s.replace(/"/g, '');

/**
 * Work out whether a file is table data (CSV/TSV/JSON Lines) or a database
 * dump, from its contents as well as its name: dumps often have no extension.
 */
export async function detectFile(file: File): Promise<Detection> {
  const head = await firstBytes(file, 5);
  const gzip = head[0] === 0x1f && head[1] === 0x8b;
  if (!gzip && String.fromCharCode(...head) === 'PGDMP') {
    return { kind: 'dump-custom', gzip: false, dump: { tables: [], partial: true, source: 'pg_dump custom format' } };
  }

  const lower = file.name.toLowerCase().replace(/\.gz$/, '');
  const byName = /\.(sql|pgsql|psql)$/.test(lower);
  const tableByName = /\.(csv|tsv|tab|ndjson|jsonl|json)$/.test(lower);
  if (tableByName) return { kind: 'table', gzip };

  let text = '';
  try {
    text = await readHead(file, gzip);
  } catch {
    return { kind: 'table', gzip };
  }
  const looksLikeDump =
    byName ||
    /^--\s*(PostgreSQL database dump|pgdeck dump)/m.test(text) ||
    /^\s*(SET\s+statement_timeout|CREATE\s+TABLE|COPY\s+\S+.*FROM\s+stdin;)/im.test(text);
  if (!looksLikeDump) return { kind: 'table', gzip };

  const tables = new Set<string>();
  for (const m of text.matchAll(/^\s*CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/gim))
    tables.add(unquote(m[1]!));
  for (const m of text.matchAll(/^COPY\s+([^\s(]+)/gm)) tables.add(unquote(m[1]!));
  const version =
    /Dumped (?:by|from) (pg_dump version [\d.]+)/.exec(text)?.[1] ??
    (/^--\s*pgdeck dump/m.test(text) ? 'pgdeck' : null);

  return {
    kind: 'dump-sql',
    gzip,
    dump: { tables: [...tables], partial: file.size > PREVIEW || gzip, source: version },
  };
}
