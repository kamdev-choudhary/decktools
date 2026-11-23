import type { DbContext } from './client.js';
import { UserError } from './errors.js';
import { createTableSql, validateTable, type NewTable } from '../shared/create-table.js';

export async function createTable(ctx: DbContext, spec: NewTable): Promise<{ ok: true; message: string }> {
  if (ctx.readonly) throw new UserError('pgdeck is running in --readonly mode', 403);
  const errors = validateTable(spec);
  if (errors.length) throw new UserError(errors.join(' '));
  const client = await ctx.pool.connect();
  try {
    await client.query('begin');
    await client.query(createTableSql(spec));
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return { ok: true, message: `Created ${spec.schema}.${spec.name}` };
}

/** Schemas you can create tables in, and the user-defined types available for columns. */
export async function getCatalog(ctx: DbContext): Promise<{ schemas: string[]; types: { name: string; kind: string }[] }> {
  const [schemas, types] = await Promise.all([
    ctx.pool.query<{ name: string }>(`
      select nspname as name from pg_namespace
      where nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and nspname not like 'pg\\_temp\\_%' and nspname not like 'pg\\_toast\\_temp\\_%'
        and has_schema_privilege(oid, 'USAGE')
      order by nspname = 'public' desc, nspname`),
    ctx.pool.query<{ name: string; kind: string }>(`
      select case when n.nspname = 'public' then t.typname else n.nspname || '.' || t.typname end as name,
             case t.typtype when 'e' then 'enum' when 'd' then 'domain' when 'r' then 'range' else 'type' end as kind
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where t.typtype in ('e', 'd', 'r') and n.nspname not in ('pg_catalog', 'information_schema')
        and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
      order by 1`),
  ]);
  return { schemas: schemas.rows.map((r) => r.name), types: types.rows };
}
