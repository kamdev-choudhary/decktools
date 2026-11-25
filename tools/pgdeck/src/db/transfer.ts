import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import Cursor from 'pg-cursor';
import { from as copyFrom } from 'pg-copy-streams';
import { createSerializer, type ExportFormat, type ImportFormat, type ImportResponse } from '../shared/export.js';
import type { Cell, RowsRequest } from '../shared/types.js';
import { RAW_TYPES, type DbContext } from './client.js';
import { UserError } from './errors.js';
import { getTableMeta } from './introspect.js';
import { buildQueryParts } from './rows.js';
import { qualified, quoteIdent } from './sql.js';

const BATCH = 2000;

export type ExportRequest = Pick<RowsRequest, 'schema' | 'table' | 'filters' | 'match' | 'sort' | 'dir'> & { format: ExportFormat };

/**
 * Stream every row matching the filters, serialized, using a server-side
 * cursor so memory stays flat no matter how big the table is.
 */
export async function* exportRows(ctx: DbContext, req: ExportRequest, signal?: AbortSignal): AsyncGenerator<string> {
  const meta = await getTableMeta(ctx, req.schema, req.table);
  const { where, values, orderBy } = buildQueryParts(meta, req);
  const columns = meta.columns.map((c) => ({ name: c.name, typeName: c.typeName }));
  const select = `select ${meta.columns.map((c) => quoteIdent(c.name)).join(', ')} from ${qualified(req.schema, req.table)}${where}${orderBy}`;
  const serializer = createSerializer(req.format, columns, { schema: req.schema, table: req.table });

  const client = await ctx.pool.connect();
  // A cursor only lives inside a transaction.
  await client.query('begin read only');
  const cursor = client.query(new Cursor<Cell[]>(select, values, { rowMode: 'array', types: RAW_TYPES }));
  try {
    yield serializer.header();
    let index = 0;
    for (;;) {
      if (signal?.aborted) return;
      const rows = await cursor.read(BATCH);
      if (!rows.length) break;
      let chunk = '';
      for (const r of rows) chunk += serializer.row(r, index++);
      yield chunk;
    }
    yield serializer.footer();
  } finally {
    await cursor.close().catch(() => {});
    await client.query('rollback').catch(() => {});
    client.release();
  }
}

export interface ImportRequest {
  schema: string;
  table: string;
  format: ImportFormat;
  /** Target table columns, in the order they appear in the file (CSV/TSV) or to pick from each object (NDJSON). */
  columns: string[];
  /** NDJSON only: the object key to read for each entry of `columns` (defaults to the column names). */
  keys?: string[];
  /** CSV/TSV: the first line is a header to skip. */
  header: boolean;
  /** CSV only. */
  delimiter: string;
  gzip: boolean;
  /** Empty the table first (inside the same transaction). */
  truncate: boolean;
}

/** JSON Lines → CSV rows for COPY, picking `columns` from each object. */
function ndjsonToCsv(keys: string[]) {
  let buffered = '';
  let line = 0;
  const csv = (v: unknown) => {
    if (v === null || v === undefined) return ''; // unquoted empty = NULL
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `"${s.replace(/"/g, '""')}"`; // always quoted, so "" stays an empty string
  };
  const convert = (text: string, out: string[]) => {
    line++;
    const t = text.trim();
    if (!t) return;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(t) as Record<string, unknown>;
    } catch {
      throw new UserError(`Line ${line} is not valid JSON`);
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new UserError(`Line ${line} is not a JSON object`);
    out.push(keys.map((k) => csv(obj[k])).join(',') + '\n');
  };
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      try {
        buffered += chunk.toString('utf8');
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        const out: string[] = [];
        for (const l of lines) convert(l, out);
        cb(null, out.join(''));
      } catch (e) {
        cb(e as Error);
      }
    },
    flush(cb: TransformCallback) {
      try {
        const out: string[] = [];
        convert(buffered, out);
        cb(null, out.join(''));
      } catch (e) {
        cb(e as Error);
      }
    },
  });
}

/** Counts bytes flowing through, for the response summary. */
function byteCounter() {
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      counter.bytes += chunk.length;
      cb(null, chunk);
    },
  }) as Transform & { bytes: number };
  counter.bytes = 0;
  return counter;
}

/**
 * Stream an uploaded file into the table with COPY FROM STDIN, in one
 * transaction: any bad row rolls the whole import back.
 */
export async function importRows(ctx: DbContext, req: ImportRequest, body: Readable): Promise<ImportResponse> {
  if (ctx.readonly) throw new UserError('pgdeck is running in --readonly mode', 403);
  const meta = await getTableMeta(ctx, req.schema, req.table);
  if (meta.kind !== 'r' && meta.kind !== 'p') throw new UserError('Data can only be imported into tables');
  if (!req.columns.length) throw new UserError('Choose at least one column to import');
  const known = new Set(meta.columns.map((c) => c.name));
  for (const c of req.columns) if (!known.has(c)) throw new UserError(`Unknown column "${c}"`);
  if (new Set(req.columns).size !== req.columns.length) throw new UserError('Each column can only be mapped once');
  if (req.delimiter.length !== 1) throw new UserError('Delimiter must be a single character');
  if (req.keys?.length && req.keys.length !== req.columns.length) throw new UserError('keys and columns must be the same length');

  const rel = qualified(req.schema, req.table);
  const cols = req.columns.map(quoteIdent).join(', ');
  const options =
    req.format === 'tsv'
      ? `format text${req.header ? ', header true' : ''}`
      : req.format === 'ndjson'
        ? 'format csv'
        : `format csv, delimiter '${req.delimiter.replace(/'/g, "''")}'${req.header ? ', header true' : ''}`;

  const started = performance.now();
  const counter = byteCounter();
  const client = await ctx.pool.connect();
  try {
    await client.query('begin');
    if (req.truncate) await client.query(`truncate ${rel}`);
    const copy = client.query(copyFrom(`copy ${rel} (${cols}) from stdin with (${options})`));
    const stages: NodeJS.ReadWriteStream[] = [counter];
    if (req.gzip) stages.push(createGunzip());
    if (req.format === 'ndjson') stages.push(ndjsonToCsv(req.keys?.length ? req.keys : req.columns));
    await pipeline(body, ...(stages as [Transform]), copy);
    await client.query('commit');
    return { rowCount: copy.rowCount, ms: performance.now() - started, bytes: counter.bytes };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    // A client that hung up mid-upload shows up as a premature close.
    if ((err as NodeJS.ErrnoException).code === 'ERR_STREAM_PREMATURE_CLOSE') throw new UserError('Upload was cancelled; nothing was imported.');
    if ((err as NodeJS.ErrnoException).code === 'Z_DATA_ERROR') throw new UserError('The file is not valid gzip; nothing was imported.');
    throw err;
  } finally {
    client.release();
  }
}
