import type { Cell, RowKey, RowsRequest } from '../shared/types.js';
import { createPool, type DbConfig, type DbContext } from './client.js';
import { getInfo, getTableMeta, listDatabases, listTables } from './introspect.js';
import { runQuery } from './query.js';
import { getStats } from './stats.js';
import { createLiveSampler } from './live.js';
import type { Readable } from 'node:stream';
import { exportRows, importRows, type ExportRequest, type ImportRequest } from './transfer.js';
import { dumpSql, type DumpOptions } from './dump.js';
import { restoreScript, type RestoreOptions } from './restore.js';
import { deleteRows, insertRow, selectRows, updateRow } from './rows.js';


/** Operations against one database, backed by its own pool. */
export function createDatabase(config: DbConfig) {
  const ctx: DbContext = {
    pool: createPool(config),
    readonly: config.readonly,
    maxRows: config.maxRows,
  };

  return {
    readonly: config.readonly,
    info: () => getInfo(ctx),
    stats: () => getStats(ctx),
    /** A sampler that reports per-second rates since its previous call. */
    liveSampler: () => createLiveSampler(ctx),
    /** Stream all matching rows, serialized (async iterator of text chunks). */
    exportRows: (req: ExportRequest, signal?: AbortSignal) => exportRows(ctx, req, signal),
    /** COPY an uploaded stream into a table. */
    importRows: (req: ImportRequest, body: Readable) => importRows(ctx, req, body),
    /** pg_dump-style SQL for some or all tables (async iterator of chunks). */
    dumpSql: (opts: DumpOptions) => dumpSql(ctx, opts),
    /** Run an uploaded SQL dump (or pg_dump custom file). */
    restore: (body: Readable, opts: RestoreOptions) => restoreScript(ctx, body, opts),
    listDatabases: () => listDatabases(ctx),
    tables: () => listTables(ctx),
    meta: (schema: string, table: string) => getTableMeta(ctx, schema, table),
    rows: (req: RowsRequest) => selectRows(ctx, req),
    insert: (schema: string, table: string, values: Record<string, Cell>) => insertRow(ctx, schema, table, values),
    update: (schema: string, table: string, key: RowKey, values: Record<string, Cell>) =>
      updateRow(ctx, schema, table, key, values),
    remove: (schema: string, table: string, keys: RowKey[]) => deleteRows(ctx, schema, table, keys),
    query: (sql: string) => runQuery(ctx, sql),
    close: () => ctx.pool.end(),
  };
}

export type Database = ReturnType<typeof createDatabase>;
