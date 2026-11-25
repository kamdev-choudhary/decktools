import type { DbContext } from './client.js';
import { UserError } from './errors.js';
import { splitStatements } from './restore.js';
import { quoteIdent } from './sql.js';
import type { ExplainResponse, StatementSort, StatementsResponse } from '../shared/types.js';

/**
 * EXPLAIN one statement and return the JSON plan. With `analyze` the statement
 * really runs, inside a transaction that is always rolled back, so writes are
 * undone. The extended protocol guarantees only a single statement executes.
 */
export async function explainQuery(ctx: DbContext, sql: string, analyze: boolean): Promise<ExplainResponse> {
  const text = sql.trim().replace(/;\s*$/, '');
  if (!text) throw new UserError('Nothing to explain');
  if (/^\s*explain\b/i.test(text.replace(/^(\s*--[^\n]*\n|\s*\/\*[\s\S]*?\*\/)*/g, ''))) {
    throw new UserError('Leave out EXPLAIN: pgdeck adds it for you.');
  }

  const client = await ctx.pool.connect();
  try {
    const { rows: v } = await client.query<{ v: number }>(`select current_setting('server_version_num')::int as v`);
    const version = v[0]!.v;
    // Normalized queries (e.g. from pg_stat_statements) have $1 placeholders: PG16+ can plan them generically.
    const hasParams = /\$\d/.test(text);
    if (hasParams && analyze) throw new UserError('This query has $1-style parameters. Replace them with real values to run EXPLAIN ANALYZE.');
    if (hasParams && version < 160000) {
      throw new UserError('This query has $1-style parameters. Replace them with real values (PostgreSQL 16+ can plan them as-is).');
    }
    const generic = hasParams;
    // Parameters can't go through the extended protocol unbound, so a generic plan uses the simple
    // protocol; make sure it is exactly one statement first so nothing else can run.
    if (generic && splitStatements(text).length !== 1) throw new UserError('Explain one statement at a time: select it in the editor first.');
    const options = analyze ? 'ANALYZE, BUFFERS, FORMAT JSON' : `FORMAT JSON${generic ? ', GENERIC_PLAN' : ''}`;

    await client.query('begin');
    const started = performance.now();
    let rows: Record<string, unknown>[];
    try {
      ({ rows } = generic
        ? await client.query(`EXPLAIN (${options}) ${text}`)
        : await client.query({ text: `EXPLAIN (${options}) ${text}`, queryMode: 'extended' } as never));
    } catch (e) {
      const err = e as Error & { code?: string };
      if (/multiple commands/i.test(err.message)) throw new UserError('Explain one statement at a time: select it in the editor first.');
      throw e;
    } finally {
      await client.query('rollback').catch(() => {});
    }
    const ms = performance.now() - started;
    const plan = (rows[0]?.['QUERY PLAN'] as unknown[] | undefined)?.[0];
    if (!plan) throw new UserError('Postgres returned no plan');
    return { plan: plan as ExplainResponse['plan'], analyzed: analyze, generic, ms };
  } finally {
    client.release();
  }
}

interface ExtState {
  installed: boolean;
  schema: string | null;
  preloaded: boolean;
  available: boolean;
  version: number;
}

async function statementsState(ctx: DbContext): Promise<ExtState> {
  const { rows } = await ctx.pool.query<ExtState>(`
    select exists(select 1 from pg_extension where extname = 'pg_stat_statements') as installed,
           (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_stat_statements') as schema,
           current_setting('shared_preload_libraries') ilike '%pg_stat_statements%' as preloaded,
           exists(select 1 from pg_available_extensions where name = 'pg_stat_statements') as available,
           current_setting('server_version_num')::int as version`);
  return rows[0]!;
}

const SORT_SQL: Record<StatementSort, string> = { total: 'total_ms', mean: 'mean_ms', calls: 'calls', rows: 'rows' };

/** The most expensive statements recorded by pg_stat_statements for this database. */
export async function listStatements(ctx: DbContext, sort: StatementSort, limit: number): Promise<StatementsResponse> {
  const st = await statementsState(ctx);
  if (!st.installed) return { status: st.preloaded ? 'not-created' : st.available ? 'not-preloaded' : 'unavailable', statements: [], totalMs: 0 };

  const view = `${quoteIdent(st.schema ?? 'public')}.pg_stat_statements`;
  const total = st.version >= 130000 ? 'total_exec_time' : 'total_time';
  const mean = st.version >= 130000 ? 'mean_exec_time' : 'mean_time';
  try {
    const { rows } = await ctx.pool.query(`
      with s as (
        select queryid::text as id, query, calls::float8 as calls, ${total}::float8 as total_ms, ${mean}::float8 as mean_ms,
               rows::float8 as rows, shared_blks_hit::float8 as hit, shared_blks_read::float8 as read,
               temp_blks_written::float8 as temp_written
        from ${view}
        where dbid = (select oid from pg_database where datname = current_database())
      )
      select *, sum(total_ms) over () as all_ms from s
      order by ${SORT_SQL[sort]} desc nulls last
      limit ${Math.max(1, Math.min(limit, 200))}`);
    return {
      status: 'ok',
      totalMs: Number(rows[0]?.all_ms ?? 0),
      statements: rows.map((r) => ({
        id: r.id,
        query: r.query,
        calls: Number(r.calls),
        totalMs: Number(r.total_ms),
        meanMs: Number(r.mean_ms),
        rows: Number(r.rows),
        cacheHitRatio: Number(r.hit) + Number(r.read) > 0 ? Number(r.hit) / (Number(r.hit) + Number(r.read)) : null,
        tempWrittenBlocks: Number(r.temp_written),
      })),
    };
  } catch (e) {
    if (/shared_preload_libraries/i.test((e as Error).message)) return { status: 'not-preloaded', statements: [], totalMs: 0 };
    throw e;
  }
}

export async function enableStatements(ctx: DbContext): Promise<{ ok: true; message: string }> {
  if (ctx.readonly) throw new UserError('pgdeck is running in --readonly mode', 403);
  await ctx.pool.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
  return { ok: true, message: 'pg_stat_statements is enabled for this database' };
}

export async function resetStatements(ctx: DbContext): Promise<{ ok: true; message: string }> {
  if (ctx.readonly) throw new UserError('pgdeck is running in --readonly mode', 403);
  const st = await statementsState(ctx);
  if (!st.installed) throw new UserError('pg_stat_statements is not enabled for this database');
  await ctx.pool.query(`select ${quoteIdent(st.schema ?? 'public')}.pg_stat_statements_reset()`);
  return { ok: true, message: 'Query statistics reset' };
}

/** Cancel a session's running query, or terminate the session, if it belongs to this database. */
export async function signalSession(ctx: DbContext, pid: number, terminate: boolean): Promise<{ ok: true; message: string }> {
  if (ctx.readonly) throw new UserError('pgdeck is running in --readonly mode', 403);
  const fn = terminate ? 'pg_terminate_backend' : 'pg_cancel_backend';
  const { rows } = await ctx.pool.query<{ ok: boolean }>(
    `select ${fn}(pid) as ok from pg_stat_activity where pid = $1 and datname = current_database() and pid <> pg_backend_pid()`,
    [pid],
  );
  if (!rows.length) throw new UserError('That session has already ended.', 404);
  if (!rows[0]!.ok) throw new UserError(`Postgres refused to ${terminate ? 'terminate' : 'cancel'} session ${pid}.`);
  return { ok: true, message: terminate ? `Terminated session ${pid}` : `Sent cancel to session ${pid}` };
}
