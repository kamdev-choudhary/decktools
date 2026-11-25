import type pg from 'pg';
import type {
  Cell,
  Filter,
  FilterMatch,
  MutationResponse,
  RowKey,
  RowsRequest,
  RowsResponse,
  TableMeta,
} from '../shared/types.js';
import { queryRaw, withTransaction, type DbContext } from './client.js';
import { UserError } from './errors.js';
import { getTableMeta } from './introspect.js';
import { FILTER_SQL, isListOp, isUnaryOp, qualified, quoteIdent, splitList } from './sql.js';

/** Above this planner estimate an unfiltered count(*) is skipped as too slow. */
const EXACT_COUNT_THRESHOLD = 50_000;

function assertColumns(meta: TableMeta, names: Iterable<string>): void {
  const known = new Set(meta.columns.map((c) => c.name));
  for (const name of names) {
    if (!known.has(name)) throw new UserError(`Unknown column "${name}" on ${meta.schema}.${meta.table}`);
  }
}

function assertWritable(ctx: DbContext, meta: TableMeta): void {
  if (ctx.readonly) throw new UserError('pgdeck is running in --readonly mode', 403);
  if (!meta.editable)
    throw new UserError(
      `${meta.schema}.${meta.table} has no primary key or is not a table, so it cannot be edited here`,
    );
}

function buildWhere(meta: TableMeta, filters: Filter[], match: FilterMatch, values: unknown[]): string {
  assertColumns(
    meta,
    filters.map((f) => f.col),
  );
  const parts = filters.map((f) => {
    const toSql = FILTER_SQL[f.op];
    if (isUnaryOp(f.op)) return toSql(quoteIdent(f.col), '');
    values.push(isListOp(f.op) ? splitList(f.val ?? '') : (f.val ?? ''));
    return toSql(quoteIdent(f.col), `$${values.length}`);
  });
  if (!parts.length) return '';
  // Parenthesise each condition so OR can't bind across an operator's own logic.
  return ` where ${parts.map((p) => `(${p})`).join(match === 'or' ? ' or ' : ' and ')}`;
}

function buildKeyWhere(meta: TableMeta, key: RowKey, values: unknown[]): string {
  if (meta.keyMode === 'ctid') {
    if (!key.ctid) throw new UserError('Missing row ctid');
    values.push(key.ctid);
    return `ctid = $${values.length}::tid`;
  }
  if (meta.keyMode !== 'pk') throw new UserError('This relation has no key; rows cannot be addressed');
  return meta.primaryKey
    .map((col) => {
      if (!(col in key)) throw new UserError(`Missing primary key column "${col}"`);
      values.push(key[col]);
      return `${quoteIdent(col)} = $${values.length}`;
    })
    .join(' and ');
}

/** WHERE (with its parameters) and ORDER BY for a filtered/sorted read of a table. */
export function buildQueryParts(
  meta: TableMeta,
  req: Pick<RowsRequest, 'filters' | 'match' | 'sort' | 'dir'>,
): { where: string; values: unknown[]; orderBy: string } {
  const values: unknown[] = [];
  const where = buildWhere(meta, req.filters ?? [], req.match ?? 'and', values);

  let orderBy = '';
  if (req.sort) {
    assertColumns(meta, [req.sort]);
    orderBy = ` order by ${quoteIdent(req.sort)} ${req.dir === 'desc' ? 'desc' : 'asc'} nulls last`;
  } else if (meta.primaryKey.length) {
    orderBy = ` order by ${meta.primaryKey.map(quoteIdent).join(', ')}`;
  }
  return { where, values, orderBy };
}

export async function selectRows(ctx: DbContext, req: RowsRequest): Promise<RowsResponse> {
  const meta = await getTableMeta(ctx, req.schema, req.table);
  const limit = Math.min(Math.max(req.limit, 1), ctx.maxRows);
  const offset = Math.max(req.offset, 0);
  const rel = qualified(req.schema, req.table);

  const { where, values, orderBy } = buildQueryParts(meta, req);

  const withCtid = meta.keyMode === 'ctid';
  const select = `select ${withCtid ? 'ctid::text, ' : ''}* from ${rel}${where}${orderBy} limit ${limit} offset ${offset}`;

  const countPromise: Promise<{ total: number; totalExact: boolean }> =
    !where && meta.estimate > EXACT_COUNT_THRESHOLD
      ? Promise.resolve({ total: meta.estimate, totalExact: false })
      : ctx.pool
          .query<{ n: string }>(`select count(*) as n from ${rel}${where}`, values)
          .then((r) => ({ total: Number(r.rows[0]!.n), totalExact: true }));

  const [result, count] = await Promise.all([queryRaw(ctx.pool, select, values), countPromise]);

  const skip = withCtid ? 1 : 0;
  return {
    fields: result.fields.slice(skip).map((f) => f.name),
    rows: withCtid ? result.rows.map((r) => r.slice(1)) : result.rows,
    ctids: withCtid ? result.rows.map((r) => r[0] as string) : undefined,
    ...count,
    limit,
    offset,
  };
}

export async function insertRow(
  ctx: DbContext,
  schema: string,
  table: string,
  row: Record<string, Cell>,
): Promise<MutationResponse> {
  const meta = await getTableMeta(ctx, schema, table);
  assertWritable(ctx, meta);
  const names = Object.keys(row);
  assertColumns(meta, names);
  const rel = qualified(schema, table);
  const sql = names.length
    ? `insert into ${rel} (${names.map(quoteIdent).join(', ')}) values (${names.map((_, i) => `$${i + 1}`).join(', ')})`
    : `insert into ${rel} default values`;
  const result = await ctx.pool.query(
    sql,
    names.map((n) => row[n]),
  );
  return { rowCount: result.rowCount ?? 0 };
}

export async function updateRow(
  ctx: DbContext,
  schema: string,
  table: string,
  key: RowKey,
  changes: Record<string, Cell>,
): Promise<MutationResponse> {
  const meta = await getTableMeta(ctx, schema, table);
  assertWritable(ctx, meta);
  const names = Object.keys(changes);
  if (!names.length) return { rowCount: 0 };
  assertColumns(meta, names);

  const values: unknown[] = names.map((n) => changes[n]);
  const set = names.map((n, i) => `${quoteIdent(n)} = $${i + 1}`).join(', ');
  const where = buildKeyWhere(meta, key, values);

  return withTransaction(ctx.pool, async (client: pg.PoolClient) => {
    const result = await client.query(`update ${qualified(schema, table)} set ${set} where ${where}`, values);
    if (result.rowCount !== 1) {
      throw new UserError(`Expected to update 1 row but matched ${result.rowCount}. Nothing was changed.`, 409);
    }
    return { rowCount: 1 };
  });
}

export async function deleteRows(
  ctx: DbContext,
  schema: string,
  table: string,
  keys: RowKey[],
): Promise<MutationResponse> {
  const meta = await getTableMeta(ctx, schema, table);
  assertWritable(ctx, meta);
  const rel = qualified(schema, table);

  return withTransaction(ctx.pool, async (client: pg.PoolClient) => {
    let rowCount = 0;
    for (const key of keys) {
      const values: unknown[] = [];
      const where = buildKeyWhere(meta, key, values);
      const result = await client.query(`delete from ${rel} where ${where}`, values);
      if ((result.rowCount ?? 0) > 1) {
        throw new UserError(`A key matched ${result.rowCount} rows. Nothing was deleted.`, 409);
      }
      rowCount += result.rowCount ?? 0;
    }
    return { rowCount };
  });
}
