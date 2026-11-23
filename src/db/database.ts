import type { Cell, RowKey, RowsRequest } from '../shared/types.js';
import { createPool, type DbConfig, type DbContext } from './client.js';
import { getInfo, getTableMeta, listDatabases, listTables } from './introspect.js';
import { runQuery } from './query.js';
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
