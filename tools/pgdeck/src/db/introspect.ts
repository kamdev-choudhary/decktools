import type {
  Column,
  Constraint,
  DatabaseSummary,
  DbInfo,
  ForeignKey,
  IncomingReference,
  Index,
  RelKind,
  TableMeta,
  TableRef,
} from '../shared/types.js';
import type { DbContext } from './client.js';
import { UserError } from './errors.js';

export async function getInfo(ctx: DbContext): Promise<DbInfo> {
  const { rows } = await ctx.pool.query<Omit<DbInfo, 'readonly'>>(`
    select version() as version,
           current_database() as database,
           current_user as "user",
           pg_size_pretty(pg_database_size(current_database())) as size,
           host(inet_server_addr()) as host,
           inet_server_port() as port`);
  return { ...rows[0]!, readonly: ctx.readonly };
}

/** Databases on this server the current role may connect to. */
export async function listDatabases(ctx: DbContext): Promise<DatabaseSummary[]> {
  const { rows } = await ctx.pool.query<DatabaseSummary>(`
    select datname as name, pg_size_pretty(pg_database_size(datname)) as size
    from pg_database
    where not datistemplate and datallowconn and has_database_privilege(datname, 'CONNECT')
    order by datname`);
  return rows;
}

export async function listTables(ctx: DbContext): Promise<TableRef[]> {
  const { rows } = await ctx.pool.query<TableRef>(`
    select n.nspname as schema, c.relname as name, c.relkind as kind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'v', 'm', 'p', 'f')
      and not c.relispartition
      and n.nspname not in ('pg_catalog', 'information_schema')
      and n.nspname not like 'pg\\_toast%'
      and n.nspname not like 'pg\\_temp%'
    order by n.nspname = 'public' desc, n.nspname, c.relname`);
  return rows;
}

interface RelationRow {
  oid: number;
  kind: RelKind;
  estimate: string;
  size: string;
  comment: string | null;
}

export async function getTableMeta(ctx: DbContext, schema: string, table: string): Promise<TableMeta> {
  const rel = await ctx.pool.query<RelationRow>(
    `select c.oid, c.relkind as kind, c.reltuples::bigint as estimate,
            pg_size_pretty(pg_total_relation_size(c.oid)) as size,
            obj_description(c.oid, 'pg_class') as comment
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1 and c.relname = $2`,
    [schema, table],
  );
  const relation = rel.rows[0];
  if (!relation) throw new UserError(`Relation ${schema}.${table} not found`, 404);
  const { oid, kind } = relation;

  // Column names of a constraint's key, in key order, as text[] (parsed to string[] by pg).
  const keyCols = (rel: string, key: string) =>
    `(select array_agg(a.attname::text order by k.ord)
        from unnest(${key}) with ordinality k(attnum, ord)
        join pg_attribute a on a.attrelid = ${rel} and a.attnum = k.attnum)`;

  const [columns, pk, indexes, constraints, foreignKeys, referencedBy] = await Promise.all([
    ctx.pool.query<Column>(
      `select a.attname as name,
              format_type(a.atttypid, a.atttypmod) as type,
              coalesce(bt.typname, t.typname) as "typeName",
              coalesce(bt.typcategory, t.typcategory) as category,
              (select array_agg(e.enumlabel::text order by e.enumsortorder)
                 from pg_enum e where e.enumtypid = coalesce(bt.oid, t.oid)) as "enumValues",
              not a.attnotnull as nullable,
              pg_get_expr(d.adbin, d.adrelid) as "default",
              a.attidentity <> '' as identity,
              a.attgenerated <> '' as generated,
              col_description(a.attrelid, a.attnum) as comment
       from pg_attribute a
       join pg_type t on t.oid = a.atttypid
       left join pg_type bt on t.typtype = 'd' and bt.oid = t.typbasetype -- look through domains
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where a.attrelid = $1 and a.attnum > 0 and not a.attisdropped
       order by a.attnum`,
      [oid],
    ),
    ctx.pool.query<{ name: string }>(
      `select a.attname as name
       from pg_index i
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       where i.indrelid = $1 and i.indisprimary
       order by array_position(i.indkey::int2[], a.attnum)`,
      [oid],
    ),
    ctx.pool.query<Index>(
      `select c.relname as name, pg_get_indexdef(i.indexrelid) as definition,
              i.indisunique as unique, i.indisprimary as primary
       from pg_index i
       join pg_class c on c.oid = i.indexrelid
       where i.indrelid = $1
       order by i.indisprimary desc, c.relname`,
      [oid],
    ),
    ctx.pool.query<Constraint>(
      `select conname as name, contype as type, pg_get_constraintdef(oid) as definition
       from pg_constraint
       where conrelid = $1
       order by array_position(array['p','u','f','c','x','t']::"char"[], contype), conname`,
      [oid],
    ),
    ctx.pool.query<ForeignKey>(
      `select c.conname as name,
              ${keyCols('c.conrelid', 'c.conkey')} as columns,
              rn.nspname as "refSchema", rc.relname as "refTable",
              ${keyCols('c.confrelid', 'c.confkey')} as "refColumns"
       from pg_constraint c
       join pg_class rc on rc.oid = c.confrelid
       join pg_namespace rn on rn.oid = rc.relnamespace
       where c.conrelid = $1 and c.contype = 'f'
       order by c.conname`,
      [oid],
    ),
    ctx.pool.query<IncomingReference>(
      `select c.conname as name, sn.nspname as schema, sc.relname as table,
              ${keyCols('c.conrelid', 'c.conkey')} as columns,
              ${keyCols('c.confrelid', 'c.confkey')} as "refColumns"
       from pg_constraint c
       join pg_class sc on sc.oid = c.conrelid
       join pg_namespace sn on sn.oid = sc.relnamespace
       where c.confrelid = $1 and c.contype = 'f'
       order by sn.nspname, sc.relname, c.conname`,
      [oid],
    ),
  ]);

  const primaryKey = pk.rows.map((r) => r.name);
  const isTable = kind === 'r' || kind === 'p';
  // ctid is only stable/unique within a single heap, so not for partitioned parents.
  const keyMode = primaryKey.length ? 'pk' : kind === 'r' ? 'ctid' : null;

  return {
    schema,
    table,
    kind,
    estimate: Number(relation.estimate),
    size: relation.size,
    comment: relation.comment,
    columns: columns.rows,
    primaryKey,
    keyMode,
    editable: !ctx.readonly && isTable && keyMode !== null,
    indexes: indexes.rows,
    constraints: constraints.rows,
    foreignKeys: foreignKeys.rows,
    referencedBy: referencedBy.rows,
  };
}
