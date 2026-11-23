import type { DbContext } from './client.js';
import { dumpSql } from './dump.js';
import { UserError } from './errors.js';
import { getTableMeta } from './introspect.js';
import { qualified, quoteIdent } from './sql.js';

import type { TableAction } from '../shared/types.js';

export type { TableAction };

const KIND_SQL: Record<string, string> = { r: 'TABLE', p: 'TABLE', v: 'VIEW', m: 'MATERIALIZED VIEW', f: 'FOREIGN TABLE' };

export async function runTableAction(ctx: DbContext, schema: string, table: string, a: TableAction): Promise<{ ok: true; message: string }> {
  const meta = await getTableMeta(ctx, schema, table);
  const rel = qualified(schema, table);
  const kind = KIND_SQL[meta.kind] ?? 'TABLE';
  const isTable = meta.kind === 'r' || meta.kind === 'p';
  const changes = a.action !== 'analyze' && a.action !== 'vacuum';
  if (ctx.readonly && changes) throw new UserError('pgdeck is running in --readonly mode', 403);

  switch (a.action) {
    case 'truncate':
      if (!isTable) throw new UserError('Only tables can be truncated');
      await ctx.pool.query(`TRUNCATE ${rel}${a.restartIdentity ? ' RESTART IDENTITY' : ''}${a.cascade ? ' CASCADE' : ''}`);
      return { ok: true, message: `Emptied ${schema}.${table}` };

    case 'drop':
      await ctx.pool.query(`DROP ${kind} ${rel}${a.cascade ? ' CASCADE' : ''}`);
      return { ok: true, message: `Dropped ${schema}.${table}` };

    case 'rename':
      await ctx.pool.query(`ALTER ${kind} ${rel} RENAME TO ${quoteIdent(a.newName)}`);
      return { ok: true, message: `Renamed to ${a.newName}` };

    case 'duplicate': {
      if (!isTable) throw new UserError('Only tables can be duplicated');
      const target = qualified(schema, a.newName);
      const client = await ctx.pool.connect();
      try {
        await client.query('begin');
        // Columns, defaults, constraints (except FKs), indexes, identity, generated columns, comments.
        await client.query(`CREATE TABLE ${target} (LIKE ${rel} INCLUDING ALL)`);
        if (a.withData) {
          const cols = meta.columns.filter((c) => !c.generated).map((c) => quoteIdent(c.name)).join(', ');
          await client.query(`INSERT INTO ${target} (${cols}) OVERRIDING SYSTEM VALUE SELECT ${cols} FROM ${rel}`);
        }
        await client.query('commit');
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      return { ok: true, message: `Created ${schema}.${a.newName}${a.withData ? ' with data' : ''}` };
    }

    case 'vacuum':
      if (!isTable && meta.kind !== 'm') throw new UserError('Only tables and materialized views can be vacuumed');
      await ctx.pool.query(`VACUUM (${a.full ? 'FULL, ' : ''}ANALYZE) ${rel}`);
      return { ok: true, message: `Vacuumed ${schema}.${table}` };

    case 'analyze':
      await ctx.pool.query(`ANALYZE ${rel}`);
      return { ok: true, message: `Analyzed ${schema}.${table}` };

    case 'refresh':
      if (meta.kind !== 'm') throw new UserError('Only materialized views can be refreshed');
      await ctx.pool.query(`REFRESH MATERIALIZED VIEW ${rel}`);
      return { ok: true, message: `Refreshed ${schema}.${table}` };
  }
}

/** The CREATE statement(s) for one relation: table DDL with indexes and FKs, or a view definition. */
export async function relationDdl(ctx: DbContext, schema: string, table: string): Promise<string> {
  const meta = await getTableMeta(ctx, schema, table);
  if (meta.kind === 'v' || meta.kind === 'm') {
    const { rows } = await ctx.pool.query<{ def: string }>(`select pg_get_viewdef(($1)::regclass, true) as def`, [qualified(schema, table)]);
    return `CREATE ${meta.kind === 'm' ? 'MATERIALIZED VIEW' : 'VIEW'} ${qualified(schema, table)} AS\n${rows[0]!.def.trimEnd().replace(/;$/, '')};\n`;
  }
  let out = '';
  for await (const chunk of dumpSql(ctx, { tables: [{ schema, table }], structure: true, data: false, keepOutsideForeignKeys: true })) out += chunk.toString();
  // Keep only the object definitions, not the dump preamble/settings.
  return out
    .split('\n')
    .filter((l) => !/^(--|SET |SELECT pg_catalog\.set_config)/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .concat('\n');
}
