import type { DbContext } from './client.js';
import { UserError } from './errors.js';
import { quoteIdent } from './sql.js';
import type { AvailableExtension, DbObjects, ObjectAction, ObjectDetail, ObjectKind } from '../shared/types.js';

const USER_NS = `n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and n.nspname not like 'pg\\_temp\\_%' and n.nspname not like 'pg\\_toast\\_temp\\_%'`;
/** Objects created by an extension are managed by it, so they're listed under the extension instead. */
const NOT_FROM_EXT = (cls: string, col: string) =>
  `not exists (select 1 from pg_depend d where d.classid = '${cls}'::regclass and d.objid = ${col} and d.deptype = 'e')`;

export async function listObjects(ctx: DbContext): Promise<DbObjects> {
  const [functions, triggers, sequences, extensions] = await Promise.all([
    ctx.pool.query(`
      select p.oid::int8 as oid, n.nspname as schema, p.proname as name,
             pg_get_function_identity_arguments(p.oid) as args, p.prokind as kind,
             case when p.prokind in ('f', 'w') then pg_get_function_result(p.oid) end as returns, l.lanname as language
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
      where ${USER_NS} and ${NOT_FROM_EXT('pg_proc', 'p.oid')}
      order by n.nspname, p.proname, 4`),
    ctx.pool.query(`
      select t.oid::int8 as oid, n.nspname as schema, c.relname as table, t.tgname as name,
             t.tgenabled <> 'D' as enabled, p.proname as function
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      where not t.tgisinternal and ${USER_NS} and ${NOT_FROM_EXT('pg_trigger', 't.oid')}
      order by n.nspname, c.relname, t.tgname`),
    ctx.pool.query(`
      select c.oid::int8 as oid, n.nspname as schema, c.relname as name,
             (select format('%s.%s', tc.relname, a.attname) from pg_depend d
                join pg_class tc on tc.oid = d.refobjid
                join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
               where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype in ('a', 'i') limit 1) as "ownedBy",
             s.last_value::text as "lastValue"
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      left join pg_sequences s on s.schemaname = n.nspname and s.sequencename = c.relname
      where c.relkind = 'S' and ${USER_NS} and ${NOT_FROM_EXT('pg_class', 'c.oid')}
      order by n.nspname, c.relname`),
    ctx.pool.query(`
      select e.oid::int8 as oid, e.extname as name, e.extversion as version, n.nspname as schema,
             a.default_version as "defaultVersion", obj_description(e.oid, 'pg_extension') as comment
      from pg_extension e join pg_namespace n on n.oid = e.extnamespace
      left join pg_available_extensions a on a.name = e.extname
      order by e.extname`),
  ]);
  const num = <T extends { oid: unknown }>(rows: T[]) => rows.map((r) => ({ ...r, oid: Number(r.oid) }));
  return {
    functions: num(functions.rows),
    triggers: num(triggers.rows),
    sequences: num(sequences.rows),
    extensions: num(extensions.rows),
  } as DbObjects;
}

export async function availableExtensions(ctx: DbContext): Promise<AvailableExtension[]> {
  const { rows } = await ctx.pool.query<AvailableExtension>(`
    select name, default_version as "defaultVersion", comment from pg_available_extensions
    where installed_version is null order by name`);
  return rows;
}

const VOLATILITY: Record<string, string> = { i: 'immutable', s: 'stable', v: 'volatile' };
const KIND_NAME: Record<string, string> = { f: 'function', p: 'procedure', a: 'aggregate', w: 'window function' };

async function functionDetail(ctx: DbContext, oid: number) {
  const { rows } = await ctx.pool.query(
    `select n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as args, p.prokind as kind,
            case when p.prokind in ('f', 'w') then pg_get_function_result(p.oid) end as returns,
            l.lanname as language, p.provolatile as volatility, p.prosecdef as secdef, p.proisstrict as strict,
            pg_get_userbyid(p.proowner) as owner, obj_description(p.oid, 'pg_proc') as comment,
            case when p.prokind <> 'a' then pg_get_functiondef(p.oid) end as def
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
     where p.oid = $1`,
    [oid],
  );
  const f = rows[0];
  if (!f) throw new UserError('That function no longer exists.', 404);
  return f;
}

export async function getObject(ctx: DbContext, kind: ObjectKind, oid: number): Promise<ObjectDetail> {
  switch (kind) {
    case 'function': {
      const f = await functionDetail(ctx, oid);
      const props: [string, string][] = [
        ['Kind', KIND_NAME[f.kind] ?? f.kind],
        ['Arguments', f.args || '(none)'],
        ...(f.returns ? [['Returns', f.returns] as [string, string]] : []),
        ['Language', f.language],
        ['Volatility', VOLATILITY[f.volatility] ?? f.volatility],
        ['Security', f.secdef ? 'definer (runs as its owner)' : 'invoker'],
        ['Strict', f.strict ? 'yes (returns null on null input)' : 'no'],
        ['Owner', f.owner],
        ...(f.comment ? [['Comment', f.comment] as [string, string]] : []),
      ];
      return {
        kind,
        oid,
        name: f.name,
        schema: f.schema,
        title: `${f.name}(${f.args})`,
        definition:
          f.def ?? `-- Aggregates can't be shown as a single CREATE statement.\n-- ${f.schema}.${f.name}(${f.args})`,
        editable: f.kind !== 'a',
        properties: props,
      };
    }
    case 'trigger': {
      const { rows } = await ctx.pool.query(
        `select n.nspname as schema, c.relname as table, t.tgname as name, t.tgenabled as enabled, t.tgfoid::int8 as fn,
                pg_get_triggerdef(t.oid, true) as def, obj_description(t.oid, 'pg_trigger') as comment
         from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where t.oid = $1`,
        [oid],
      );
      const t = rows[0];
      if (!t) throw new UserError('That trigger no longer exists.', 404);
      const f = await functionDetail(ctx, Number(t.fn)).catch(() => null);
      return {
        kind,
        oid,
        name: t.name,
        schema: t.schema,
        title: t.name,
        definition: `${t.def};`,
        editable: false,
        properties: [
          ['Table', `${t.schema}.${t.table}`],
          ['Status', t.enabled === 'D' ? 'disabled' : 'enabled'],
          ['Function', f ? `${f.schema}.${f.name}()` : '?'],
          ...(t.comment ? [['Comment', t.comment] as [string, string]] : []),
        ],
        triggerFunction: f
          ? { oid: Number(t.fn), title: `${f.schema}.${f.name}(${f.args})`, definition: f.def ?? '' }
          : null,
      };
    }
    case 'sequence': {
      const { rows } = await ctx.pool.query(
        `select n.nspname as schema, c.relname as name, s.data_type::text as type, s.start_value::text as start, s.increment_by::text as inc,
                s.min_value::text as min, s.max_value::text as max, s.cache_size::text as cache, s.cycle, s.last_value::text as last,
                pg_get_userbyid(c.relowner) as owner,
                (select format('%I.%I.%I', tn.nspname, tc.relname, a.attname) from pg_depend d
                   join pg_class tc on tc.oid = d.refobjid join pg_namespace tn on tn.oid = tc.relnamespace
                   join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
                  where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype in ('a', 'i') limit 1) as owned
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         join pg_sequences s on s.schemaname = n.nspname and s.sequencename = c.relname where c.oid = $1`,
        [oid],
      );
      const s = rows[0];
      if (!s) throw new UserError('That sequence no longer exists.', 404);
      const q = `${quoteIdent(s.schema)}.${quoteIdent(s.name)}`;
      const def =
        `CREATE SEQUENCE ${q}\n  AS ${s.type}\n  START WITH ${s.start}\n  INCREMENT BY ${s.inc}\n  MINVALUE ${s.min}\n  MAXVALUE ${s.max}\n  CACHE ${s.cache}${s.cycle ? '\n  CYCLE' : ''};` +
        (s.owned ? `\n\nALTER SEQUENCE ${q} OWNED BY ${s.owned};` : '');
      return {
        kind,
        oid,
        name: s.name,
        schema: s.schema,
        title: s.name,
        definition: def,
        editable: false,
        properties: [
          ['Last value', s.last ?? 'not used yet'],
          ['Increment', s.inc],
          ['Range', `${s.min} … ${s.max}`],
          ['Type', s.type],
          ['Cycles', s.cycle ? 'yes' : 'no'],
          ['Owned by', s.owned ?? 'nothing (standalone)'],
          ['Owner', s.owner],
        ],
        sequence: { lastValue: s.last, increment: s.inc, min: s.min, max: s.max },
      };
    }
    case 'extension': {
      const { rows } = await ctx.pool.query(
        `select e.extname as name, e.extversion as version, n.nspname as schema, e.extrelocatable as relocatable,
                a.default_version as latest, obj_description(e.oid, 'pg_extension') as comment,
                (select count(*) from pg_depend d where d.refclassid = 'pg_extension'::regclass and d.refobjid = e.oid and d.deptype = 'e')::int as members
         from pg_extension e join pg_namespace n on n.oid = e.extnamespace
         left join pg_available_extensions a on a.name = e.extname where e.oid = $1`,
        [oid],
      );
      const e = rows[0];
      if (!e) throw new UserError('That extension is no longer installed.', 404);
      return {
        kind,
        oid,
        name: e.name,
        schema: e.schema,
        title: e.name,
        definition: `CREATE EXTENSION IF NOT EXISTS ${quoteIdent(e.name)} WITH SCHEMA ${quoteIdent(e.schema)} VERSION '${e.version}';`,
        editable: false,
        properties: [
          ['Version', e.version],
          ['Latest available', e.latest ?? 'unknown'],
          ['Schema', e.schema],
          ['Objects it owns', String(e.members)],
          ['Relocatable', e.relocatable ? 'yes' : 'no'],
          ...(e.comment ? [['Description', e.comment] as [string, string]] : []),
        ],
        update: e.latest && e.latest !== e.version ? e.latest : null,
      };
    }
  }
}

export async function runObjectAction(
  ctx: DbContext,
  a: ObjectAction,
): Promise<{ ok: true; message: string; oid?: number }> {
  if (ctx.readonly) throw new UserError('pgdeck is running in --readonly mode', 403);
  const cascade = (c: boolean) => (c ? ' CASCADE' : '');

  if (a.kind === 'extension' && a.action === 'create') {
    await ctx.pool.query(`CREATE EXTENSION IF NOT EXISTS ${quoteIdent(a.name)}`);
    const { rows } = await ctx.pool.query<{ oid: string }>(
      `select oid::int8 as oid from pg_extension where extname = $1`,
      [a.name],
    );
    return { ok: true, message: `Installed ${a.name}`, oid: Number(rows[0]?.oid) };
  }

  switch (a.kind) {
    case 'function': {
      const f = await functionDetail(ctx, a.oid);
      const sig = `${quoteIdent(f.schema)}.${quoteIdent(f.name)}(${f.args})`;
      if (a.action === 'drop') {
        await ctx.pool.query(
          `DROP ${f.kind === 'p' ? 'PROCEDURE' : f.kind === 'a' ? 'AGGREGATE' : 'FUNCTION'} ${sig}${cascade(a.cascade)}`,
        );
        return { ok: true, message: `Dropped ${f.name}` };
      }
      if (!/^\s*create\s+(or\s+replace\s+)?(function|procedure)\b/i.test(a.sql.replace(/^(\s*--[^\n]*\n)*/, ''))) {
        throw new UserError('The definition must start with CREATE OR REPLACE FUNCTION (or PROCEDURE).');
      }
      const client = await ctx.pool.connect();
      try {
        await client.query('begin');
        await client.query(a.sql);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      // A changed signature creates a new function; find it so the page can follow.
      const { rows } = await ctx.pool.query<{ oid: string }>(
        `select p.oid::int8 as oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = $1 and p.proname = $2 order by (p.oid = $3) desc, p.oid desc limit 1`,
        [f.schema, f.name, a.oid],
      );
      return { ok: true, message: `Saved ${f.name}`, oid: Number(rows[0]?.oid ?? a.oid) };
    }
    case 'trigger': {
      const { rows } = await ctx.pool.query(
        `select n.nspname as schema, c.relname as table, t.tgname as name from pg_trigger t
         join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where t.oid = $1`,
        [a.oid],
      );
      const t = rows[0];
      if (!t) throw new UserError('That trigger no longer exists.', 404);
      const rel = `${quoteIdent(t.schema)}.${quoteIdent(t.table)}`;
      if (a.action === 'drop') {
        await ctx.pool.query(`DROP TRIGGER ${quoteIdent(t.name)} ON ${rel}${cascade(a.cascade)}`);
        return { ok: true, message: `Dropped trigger ${t.name}` };
      }
      await ctx.pool.query(
        `ALTER TABLE ${rel} ${a.action === 'enable' ? 'ENABLE' : 'DISABLE'} TRIGGER ${quoteIdent(t.name)}`,
      );
      return { ok: true, message: `${a.action === 'enable' ? 'Enabled' : 'Disabled'} trigger ${t.name}` };
    }
    case 'sequence': {
      const { rows } = await ctx.pool.query(
        `select n.nspname as schema, c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = $1 and c.relkind = 'S'`,
        [a.oid],
      );
      const s = rows[0];
      if (!s) throw new UserError('That sequence no longer exists.', 404);
      const q = `${quoteIdent(s.schema)}.${quoteIdent(s.name)}`;
      if (a.action === 'drop') {
        await ctx.pool.query(`DROP SEQUENCE ${q}${cascade(a.cascade)}`);
        return { ok: true, message: `Dropped sequence ${s.name}` };
      }
      if (!/^-?\d+$/.test(a.value.trim())) throw new UserError('The next value must be a whole number.');
      await ctx.pool.query(`ALTER SEQUENCE ${q} RESTART WITH ${a.value.trim()}`);
      return { ok: true, message: `${s.name} will hand out ${a.value.trim()} next` };
    }
    case 'extension': {
      const { rows } = await ctx.pool.query<{ name: string }>(
        `select extname as name from pg_extension where oid = $1`,
        [a.oid],
      );
      const e = rows[0];
      if (!e) throw new UserError('That extension is no longer installed.', 404);
      if (a.action === 'drop') {
        await ctx.pool.query(`DROP EXTENSION ${quoteIdent(e.name)}${cascade(a.cascade)}`);
        return { ok: true, message: `Removed ${e.name}` };
      }
      await ctx.pool.query(`ALTER EXTENSION ${quoteIdent(e.name)} UPDATE`);
      return { ok: true, message: `Updated ${e.name}` };
    }
  }
}
