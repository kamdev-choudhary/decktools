import type pg from 'pg';
import type { Cell, QueryResponse } from '../shared/types.js';
import { queryRaw, type DbContext } from './client.js';

/**
 * Run arbitrary SQL. Multiple statements are allowed; pg returns one result
 * per statement when the simple query protocol is used (no parameters).
 */
export async function runQuery(ctx: DbContext, sql: string): Promise<QueryResponse> {
  const started = performance.now();
  const raw = (await queryRaw(ctx.pool, sql)) as pg.QueryArrayResult<Cell[]> | pg.QueryArrayResult<Cell[]>[];
  const ms = performance.now() - started;

  const results = (Array.isArray(raw) ? raw : [raw]).map((r) => {
    const rows = r.rows ?? [];
    return {
      command: r.command,
      rowCount: r.rowCount,
      fields: (r.fields ?? []).map((f) => f.name),
      rows: rows.slice(0, ctx.maxRows),
      truncated: rows.length > ctx.maxRows,
    };
  });

  return { ms, results };
}
