import type { DbContext } from './client.js';
import type { GraphForeignKey, GraphTable, SchemaGraph } from '../shared/types.js';

const SYSTEM = `n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and n.nspname not like 'pg\\_temp\\_%' and n.nspname not like 'pg\\_toast\\_temp\\_%'`;
const DEL: Record<string, string> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };

/** Every table with its columns, plus every foreign key, for the ER diagram. One round trip each. */
export async function getSchemaGraph(ctx: DbContext): Promise<SchemaGraph> {
  const [tables, fks] = await Promise.all([
    ctx.pool.query<GraphTable & { columns: GraphTable['columns'] | null }>(`
      select n.nspname as schema, c.relname as name, c.relkind as kind,
             c.reltuples::float8 as rows, obj_description(c.oid, 'pg_class') as comment,
             (select json_agg(json_build_object(
                       'name', a.attname,
                       'type', format_type(a.atttypid, a.atttypmod),
                       'nullable', not a.attnotnull,
                       'pk', coalesce((select u.i from unnest(pk.indkey::int2[]) with ordinality u(k, i) where u.k = a.attnum), 0)
                     ) order by a.attnum)
                from pg_attribute a
               where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_index pk on pk.indrelid = c.oid and pk.indisprimary
      where c.relkind in ('r', 'p', 'f') and not c.relispartition and ${SYSTEM}
        and has_table_privilege(c.oid, 'SELECT, INSERT, UPDATE, DELETE, REFERENCES')
      order by n.nspname, c.relname`),
    ctx.pool.query<GraphForeignKey & { del: string }>(`
      select k.conname as name,
             n.nspname as schema, c.relname as table,
             rn.nspname as "refSchema", rc.relname as "refTable",
             (select array_agg(a.attname::text order by x.i) from unnest(k.conkey) with ordinality x(n, i)
                join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.n) as columns,
             (select array_agg(a.attname::text order by x.i) from unnest(k.confkey) with ordinality x(n, i)
                join pg_attribute a on a.attrelid = k.confrelid and a.attnum = x.n) as "refColumns",
             k.confdeltype as del
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
      join pg_class rc on rc.oid = k.confrelid join pg_namespace rn on rn.oid = rc.relnamespace
      where k.contype = 'f' and not c.relispartition and ${SYSTEM}
      order by n.nspname, c.relname, k.conname`),
  ]);
  return {
    tables: tables.rows.map((t) => ({
      ...t,
      rows: Number(t.rows),
      columns: (t.columns ?? []).map((c) => ({ ...c, pk: Number(c.pk) })),
    })),
    foreignKeys: fks.rows.map(({ del, ...f }) => ({ ...f, onDelete: DEL[del] ?? 'NO ACTION' })),
  };
}
