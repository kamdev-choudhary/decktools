import type pg from 'pg';
import { to as copyTo } from 'pg-copy-streams';
import type { DbContext } from './client.js';
import { UserError } from './errors.js';
import { qualified, quoteIdent } from './sql.js';

/**
 * A pg_dump-style SQL export, generated from the catalogs so it works without
 * pg_dump installed. Output restores with `psql -f dump.sql`.
 *
 * Order: schemas, extensions, types, sequences, functions, tables (no FKs),
 * data (COPY, FK-dependency order), sequence values, indexes, foreign keys,
 * views, triggers. Not included: roles, grants, RLS policies, publications,
 * comments, and partitions of partitioned tables.
 */

export interface TableId {
  schema: string;
  table: string;
}

export interface DumpOptions {
  /** Tables to include; empty means the whole database (plus views, functions, extensions). */
  tables: TableId[];
  structure: boolean;
  data: boolean;
  /** Keep foreign keys to tables outside the export (for showing DDL, not for restoring). */
  keepOutsideForeignKeys?: boolean;
}

interface TableRow {
  oid: number;
  schema: string;
  name: string;
  kind: string;
}

const SYSTEM_SCHEMAS = `n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_toast%' and n.nspname not like 'pg\\_temp%'`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Tables ordered so that referenced tables come before the tables that reference them. */
function topoSort(tables: TableRow[], deps: Map<number, Set<number>>): TableRow[] {
  const byOid = new Map(tables.map((t) => [t.oid, t]));
  const out: TableRow[] = [];
  const state = new Map<number, 'visiting' | 'done'>();
  const visit = (oid: number) => {
    const s = state.get(oid);
    if (s === 'done' || s === 'visiting') return; // cycles: keep going, FKs are added after data anyway
    state.set(oid, 'visiting');
    for (const d of deps.get(oid) ?? []) if (byOid.has(d)) visit(d);
    state.set(oid, 'done');
    out.push(byOid.get(oid)!);
  };
  for (const t of tables) visit(t.oid);
  return out;
}

/** Resolve the table list (all user tables, or the requested subset) in dependency order. */
export async function resolveTables(client: pg.ClientBase, wanted: TableId[]): Promise<TableRow[]> {
  const { rows } = await client.query<TableRow>(
    `select c.oid, n.nspname as schema, c.relname as name, c.relkind as kind
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and not c.relispartition and ${SYSTEM_SCHEMAS}
     order by n.nspname, c.relname`,
  );
  let tables = rows;
  if (wanted.length) {
    const keys = new Set(wanted.map((t) => `${t.schema}.${t.table}`));
    tables = rows.filter((t) => keys.has(`${t.schema}.${t.name}`));
    const missing = wanted.filter((w) => !rows.some((t) => t.schema === w.schema && t.name === w.table));
    if (missing.length)
      throw new UserError(`Unknown table: ${missing.map((m) => `${m.schema}.${m.table}`).join(', ')}`);
  }
  const fk = await client.query<{ from: number; to: number }>(
    `select conrelid as "from", confrelid as "to" from pg_constraint where contype = 'f' and conrelid <> confrelid`,
  );
  const deps = new Map<number, Set<number>>();
  for (const { from, to } of fk.rows) (deps.get(from) ?? deps.set(from, new Set()).get(from)!).add(to);
  return topoSort(tables, deps);
}

interface ColumnRow {
  name: string;
  type: string;
  notnull: boolean;
  default: string | null;
  identity: string;
  generated: string;
}

async function tableDdl(client: pg.ClientBase, t: TableRow): Promise<string> {
  const cols = await client.query<ColumnRow>(
    `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as notnull,
            pg_get_expr(d.adbin, d.adrelid) as "default", a.attidentity as identity, a.attgenerated as generated
     from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = $1 and a.attnum > 0 and not a.attisdropped order by a.attnum`,
    [t.oid],
  );
  const cons = await client.query<{ name: string; def: string }>(
    `select conname as name, pg_get_constraintdef(oid) as def from pg_constraint
     where conrelid = $1 and contype in ('p', 'u', 'c', 'x') order by contype = 'p' desc, conname`,
    [t.oid],
  );
  const lines = cols.rows.map((c) => {
    let l = `    ${quoteIdent(c.name)} ${c.type}`;
    if (c.generated === 's') l += ` GENERATED ALWAYS AS (${c.default}) STORED`;
    else if (c.identity) l += ` GENERATED ${c.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`;
    else if (c.default !== null) l += ` DEFAULT ${c.default}`;
    if (c.notnull) l += ' NOT NULL';
    return l;
  });
  for (const k of cons.rows) lines.push(`    CONSTRAINT ${quoteIdent(k.name)} ${k.def}`);
  let partition = '';
  if (t.kind === 'p') {
    const p = await client.query<{ def: string }>(`select pg_get_partkeydef($1) as def`, [t.oid]);
    partition = ` PARTITION BY ${p.rows[0]!.def}`;
  }
  return `CREATE TABLE ${qualified(t.schema, t.name)} (\n${lines.join(',\n')}\n)${partition};\n`;
}

/** Columns COPY can write (generated columns are computed, not stored from input). */
async function copyColumns(client: pg.ClientBase, oid: number): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `select attname as name from pg_attribute where attrelid = $1 and attnum > 0 and not attisdropped and attgenerated = '' order by attnum`,
    [oid],
  );
  return rows.map((r) => r.name);
}

/**
 * Generate the dump. Uses one connection in a REPEATABLE READ, READ ONLY
 * transaction so every table is read from the same snapshot.
 */
export async function* dumpSql(ctx: DbContext, opts: DumpOptions): AsyncGenerator<string | Buffer> {
  if (!opts.structure && !opts.data) throw new UserError('Choose structure, data, or both');
  const client = await ctx.pool.connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    const full = opts.tables.length === 0;
    const tables = await resolveTables(client, opts.tables);
    const oids = tables.map((t) => t.oid);
    const info = await client.query<{ db: string; version: string; now: string }>(
      `select current_database() as db, current_setting('server_version') as version, now()::text as now`,
    );
    const i = info.rows[0]!;

    yield (
      `--\n-- pgdeck dump of database "${i.db}" (PostgreSQL ${i.version})\n-- Created ${i.now}\n` +
      `-- ${full ? 'Whole database' : `${tables.length} table(s)`}; ${opts.structure && opts.data ? 'structure and data' : opts.structure ? 'structure only' : 'data only'}\n` +
      `-- Restore with: psql -d <database> -v ON_ERROR_STOP=1 -f <this file>\n--\n\n` +
      `SET statement_timeout = 0;\nSET client_encoding = 'UTF8';\nSET standard_conforming_strings = on;\n` +
      `SET check_function_bodies = false;\nSET client_min_messages = warning;\n\n`
    );

    // ---------- structure, part 1 ----------
    if (opts.structure) {
      const schemas = await client.query<{ name: string }>(
        `select n.nspname as name from pg_namespace n where ${SYSTEM_SCHEMAS} and n.nspname <> 'public'
           and ($1::boolean or n.oid in (select relnamespace from pg_class where oid = any($2::oid[])))
           and not exists (select 1 from pg_depend d where d.objid = n.oid and d.deptype = 'e')
         order by 1`,
        [full, oids],
      );
      if (schemas.rows.length) {
        yield (
          `-- Schemas\n` +
          schemas.rows.map((s) => `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(s.name)};\n`).join('') +
          '\n'
        );
      }

      if (full) {
        const ext = await client.query<{ name: string; schema: string }>(
          `select e.extname as name, n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace
           where e.extname <> 'plpgsql' order by 1`,
        );
        if (ext.rows.length) {
          yield (
            `-- Extensions\n` +
            ext.rows
              .map((e) => `CREATE EXTENSION IF NOT EXISTS ${quoteIdent(e.name)} WITH SCHEMA ${quoteIdent(e.schema)};\n`)
              .join('') +
            '\n'
          );
        }
      }

      // Enum types: all user enums for a full dump, else those used by the chosen tables.
      const enums = await client.query<{ schema: string; name: string; labels: string[] }>(
        `select n.nspname as schema, t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
         from pg_type t join pg_namespace n on n.oid = t.typnamespace join pg_enum e on e.enumtypid = t.oid
         where ${SYSTEM_SCHEMAS}
           and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
           and ($1::boolean or t.oid in (select atttypid from pg_attribute where attrelid = any($2::oid[])))
         group by 1, 2 order by 1, 2`,
        [full, oids],
      );
      if (enums.rows.length) {
        yield (
          `-- Enum types\n` +
          enums.rows
            .map((e) => `CREATE TYPE ${qualified(e.schema, e.name)} AS ENUM (${e.labels.map(lit).join(', ')});\n`)
            .join('') +
          '\n'
        );
      }

      const domains = await client.query<{
        schema: string;
        name: string;
        base: string;
        notnull: boolean;
        def: string | null;
        checks: string[] | null;
      }>(
        `select n.nspname as schema, t.typname as name, format_type(t.typbasetype, t.typtypmod) as base, t.typnotnull as notnull,
                t.typdefault as def,
                (select array_agg(pg_get_constraintdef(c.oid)) from pg_constraint c where c.contypid = t.oid) as checks
         from pg_type t join pg_namespace n on n.oid = t.typnamespace
         where t.typtype = 'd' and ${SYSTEM_SCHEMAS}
           and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
           and ($1::boolean or t.oid in (select atttypid from pg_attribute where attrelid = any($2::oid[])))
         order by 1, 2`,
        [full, oids],
      );
      if (domains.rows.length) {
        yield (
          `-- Domains\n` +
          domains.rows
            .map(
              (d) =>
                `CREATE DOMAIN ${qualified(d.schema, d.name)} AS ${d.base}${d.def ? ` DEFAULT ${d.def}` : ''}${d.notnull ? ' NOT NULL' : ''}${(d.checks ?? []).map((c) => ` ${c}`).join('')};\n`,
            )
            .join('') +
          '\n'
        );
      }

      // Standalone sequences (identity sequences are created by their columns).
      const seqs = await client.query<{
        schema: string;
        name: string;
        type: string;
        start: string;
        inc: string;
        min: string;
        max: string;
        cache: string;
        cycle: boolean;
      }>(
        `select s.schemaname as schema, s.sequencename as name, s.data_type::text as type, s.start_value as start,
                s.increment_by as inc, s.min_value as min, s.max_value as max, s.cache_size as cache, s.cycle
         from pg_sequences s
         join pg_class c on c.relname = s.sequencename join pg_namespace n on n.oid = c.relnamespace and n.nspname = s.schemaname
         where not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'i')
           and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
           and ($1::boolean or exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'a' and d.refobjid = any($2::oid[])))
         order by 1, 2`,
        [full, oids],
      );
      if (seqs.rows.length) {
        yield (
          `-- Sequences\n` +
          seqs.rows
            .map(
              (s) =>
                `CREATE SEQUENCE IF NOT EXISTS ${qualified(s.schema, s.name)} AS ${s.type} START WITH ${s.start} INCREMENT BY ${s.inc} MINVALUE ${s.min} MAXVALUE ${s.max} CACHE ${s.cache}${s.cycle ? ' CYCLE' : ''};\n`,
            )
            .join('') +
          '\n'
        );
      }

      if (full) {
        const fns = await client.query<{ def: string }>(
          `select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where ${SYSTEM_SCHEMAS} and p.prokind in ('f', 'p')
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
           order by n.nspname, p.proname, p.oid`,
        );
        if (fns.rows.length) yield `-- Functions\n` + fns.rows.map((f) => `${f.def.trimEnd()};\n\n`).join('');
      }

      yield `-- Tables\n`;
      for (const t of tables) yield (await tableDdl(client, t)) + '\n';

      // Sequences owned by columns (serial): restore the link.
      const owned = await client.query<{ seq: string; tbl: string; col: string }>(
        `select format('%I.%I', sn.nspname, s.relname) as seq, format('%I.%I', tn.nspname, t.relname) as tbl, quote_ident(a.attname) as col
         from pg_depend d
         join pg_class s on s.oid = d.objid and s.relkind = 'S' join pg_namespace sn on sn.oid = s.relnamespace
         join pg_class t on t.oid = d.refobjid join pg_namespace tn on tn.oid = t.relnamespace
         join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
         where d.deptype = 'a' and d.refobjid = any($1::oid[])`,
        [oids],
      );
      if (owned.rows.length)
        yield owned.rows.map((o) => `ALTER SEQUENCE ${o.seq} OWNED BY ${o.tbl}.${o.col};\n`).join('') + '\n';
    }

    // ---------- data ----------
    if (opts.data) {
      yield `-- Data\n`;
      for (const t of tables) {
        const cols = await copyColumns(client, t.oid);
        const rel = qualified(t.schema, t.name);
        const list = cols.map(quoteIdent).join(', ');
        yield `COPY ${rel} (${list}) FROM stdin;\n`;
        // Text format is exactly what psql expects inside a COPY ... FROM stdin block.
        const stream = client.query(copyTo(`COPY (SELECT ${list} FROM ${rel}) TO STDOUT`));
        for await (const chunk of stream) yield chunk as Buffer;
        yield `\\.\n\n`;
      }

      // Sequence positions (standalone, serial and identity) for the included tables.
      const pos = await client.query<{ seq: string; last: string | null; start: string }>(
        `select format('%I.%I', s.schemaname, s.sequencename) as seq, s.last_value as last, s.start_value as start
         from pg_sequences s
         join pg_class c on c.relname = s.sequencename join pg_namespace n on n.oid = c.relnamespace and n.nspname = s.schemaname
         where not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
           and ($1::boolean or exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype in ('a', 'i') and d.refobjid = any($2::oid[])))
         order by 1`,
        [full, oids],
      );
      if (pos.rows.length) {
        yield (
          `-- Sequence values\n` +
          pos.rows
            .map(
              (p) =>
                `SELECT pg_catalog.setval(${lit(p.seq)}, ${p.last ?? p.start}, ${p.last === null ? 'false' : 'true'});\n`,
            )
            .join('') +
          '\n'
        );
      }
    }

    // ---------- structure, part 2 ----------
    if (opts.structure) {
      const idx = await client.query<{ def: string }>(
        `select pg_get_indexdef(i.indexrelid) as def from pg_index i
         where i.indrelid = any($1::oid[]) and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
         order by i.indrelid, i.indexrelid`,
        [oids],
      );
      if (idx.rows.length) yield `-- Indexes\n` + idx.rows.map((r) => `${r.def};\n`).join('') + '\n';

      const fks = await client.query<{ tbl: string; name: string; def: string; ref: number }>(
        `select format('%I.%I', n.nspname, c.relname) as tbl, k.conname as name, pg_get_constraintdef(k.oid) as def, k.confrelid as ref
         from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         where k.contype = 'f' and k.conrelid = any($1::oid[]) order by 1, 2`,
        [oids],
      );
      const included = new Set(oids);
      const ok = fks.rows.filter((f) => opts.keepOutsideForeignKeys || included.has(f.ref));
      const skipped = fks.rows.length - ok.length;
      if (ok.length || skipped) {
        yield (
          `-- Foreign keys\n` +
          (skipped ? `-- ${skipped} foreign key(s) skipped: they reference tables not in this export.\n` : '') +
          ok.map((f) => `ALTER TABLE ${f.tbl} ADD CONSTRAINT ${quoteIdent(f.name)} ${f.def};\n`).join('') +
          '\n'
        );
      }

      if (full) {
        const views = await client.query<{ schema: string; name: string; kind: string; def: string }>(
          `select n.nspname as schema, c.relname as name, c.relkind as kind, pg_get_viewdef(c.oid, true) as def
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where c.relkind in ('v', 'm') and ${SYSTEM_SCHEMAS}
             and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
           order by c.oid`,
        );
        if (views.rows.length) {
          yield (
            `-- Views\n` +
            views.rows
              .map(
                (v) =>
                  `CREATE ${v.kind === 'm' ? 'MATERIALIZED VIEW' : 'VIEW'} ${qualified(v.schema, v.name)} AS\n${v.def.trimEnd().replace(/;$/, '')};\n\n`,
              )
              .join('')
          );
        }
      }

      const trg = await client.query<{ def: string }>(
        `select pg_get_triggerdef(t.oid, true) as def from pg_trigger t where t.tgrelid = any($1::oid[]) and not t.tgisinternal order by t.tgrelid, t.tgname`,
        [oids],
      );
      if (trg.rows.length) yield `-- Triggers\n` + trg.rows.map((r) => `${r.def};\n`).join('') + '\n';
    }

    yield `-- End of pgdeck dump\n`;
  } finally {
    await client.query('rollback').catch(() => {});
    client.release();
  }
}
