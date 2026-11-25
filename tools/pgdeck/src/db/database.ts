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
import { alterTable, createTable, getCatalog } from './create-table.js';
import { getSchemaGraph } from './graph.js';
import { applyGrants, applySchemaPreset, getRole, listRoles, runRoleAction } from './roles.js';
import type { GrantChange, RoleAction, SchemaPreset } from '../shared/roles.js';
import { availableExtensions, getObject, listObjects, runObjectAction } from './objects.js';
import type { ObjectAction, ObjectKind } from '../shared/types.js';
import { enableStatements, explainQuery, listStatements, resetStatements, signalSession } from './perf.js';
import type { StatementSort } from '../shared/types.js';
import type { AlterAction } from '../shared/alter.js';
import type { NewTable } from '../shared/create-table.js';
import { relationDdl, runMaintenance, runTableAction, type TableAction } from './table-actions.js';
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
    /** Truncate / drop / rename / duplicate / vacuum / analyze / refresh. */
    tableAction: (schema: string, table: string, action: TableAction) => runTableAction(ctx, schema, table, action),
    ddl: (schema: string, table: string) => relationDdl(ctx, schema, table),
    maintenance: (action: 'analyze' | 'vacuum', tables: { schema: string; table: string }[]) =>
      runMaintenance(ctx, action, tables),
    createTable: (spec: NewTable) => createTable(ctx, spec),
    catalog: () => getCatalog(ctx),
    /** Tables, columns and foreign keys for the ER diagram. */
    graph: () => getSchemaGraph(ctx),
    /** Roles are server-wide; privileges are listed for this database. */
    roles: () => listRoles(ctx),
    role: (name: string) => getRole(ctx, name),
    roleAction: (a: RoleAction) => runRoleAction(ctx, a),
    grants: (role: string, changes: GrantChange[]) => applyGrants(ctx, role, changes),
    grantPreset: (role: string, schema: string, preset: SchemaPreset, future: boolean) =>
      applySchemaPreset(ctx, role, schema, preset, future),
    objects: () => listObjects(ctx),
    object: (kind: ObjectKind, oid: number) => getObject(ctx, kind, oid),
    availableExtensions: () => availableExtensions(ctx),
    objectAction: (a: ObjectAction) => runObjectAction(ctx, a),
    explain: (sql: string, analyze: boolean) => explainQuery(ctx, sql, analyze),
    statements: (sort: StatementSort, limit: number) => listStatements(ctx, sort, limit),
    enableStatements: () => enableStatements(ctx),
    resetStatements: () => resetStatements(ctx),
    signalSession: (pid: number, terminate: boolean) => signalSession(ctx, pid, terminate),
    alter: (schema: string, table: string, a: AlterAction) => alterTable(ctx, schema, table, a),
    listDatabases: () => listDatabases(ctx),
    tables: () => listTables(ctx),
    meta: (schema: string, table: string) => getTableMeta(ctx, schema, table),
    rows: (req: RowsRequest) => selectRows(ctx, req),
    insert: (schema: string, table: string, values: Record<string, Cell>) => insertRow(ctx, schema, table, values),
    update: (schema: string, table: string, key: RowKey, values: Record<string, Cell>) =>
      updateRow(ctx, schema, table, key, values),
    remove: (schema: string, table: string, keys: RowKey[]) => deleteRows(ctx, schema, table, keys),
    query: (sql: string) => runQuery(ctx, sql),
    /** Run one trusted, server-built statement outside any transaction (CREATE DATABASE etc). */
    exec: async (sql: string): Promise<void> => {
      await ctx.pool.query(sql);
    },
    close: () => ctx.pool.end(),
  };
}

export type Database = ReturnType<typeof createDatabase>;
