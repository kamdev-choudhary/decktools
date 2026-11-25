import type { DbStats, RelKind, TableStats } from '../shared/types.js';
import type { DbContext } from './client.js';

// pg returns bigint/numeric as strings; everything here fits comfortably in a double.
const num = (v: string | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);
const iso = (v: Date | null): string | null => (v ? v.toISOString() : null);

interface DatabaseRow {
  size_bytes: string;
  uptime_seconds: string;
  server_version: string;
  max_connections: number;
  conn_total: string;
  conn_active: string;
  conn_idle: string;
  conn_idle_tx: string;
  xact_commit: string | null;
  xact_rollback: string | null;
  blks_hit: string | null;
  blks_read: string | null;
  tup_inserted: string | null;
  tup_updated: string | null;
  tup_deleted: string | null;
  tup_fetched: string | null;
  deadlocks: string | null;
  temp_bytes: string | null;
  stats_reset: Date | null;
}

interface TableRow {
  schema: string;
  name: string;
  kind: RelKind;
  rows: string;
  dead_rows: string | null;
  table_bytes: string;
  index_bytes: string;
  total_bytes: string;
  index_count: string;
  seq_scan: string | null;
  idx_scan: string | null;
  last_vacuum: Date | null;
  last_analyze: Date | null;
}

export async function getStats(ctx: DbContext): Promise<DbStats> {
  const [db, tables, extensions] = await Promise.all([
    ctx.pool.query<DatabaseRow>(`
      select pg_database_size(current_database()) as size_bytes,
             extract(epoch from now() - pg_postmaster_start_time())::bigint as uptime_seconds,
             current_setting('server_version') as server_version,
             current_setting('max_connections')::int as max_connections,
             a.total as conn_total, a.active as conn_active, a.idle as conn_idle, a.idle_tx as conn_idle_tx,
             d.xact_commit, d.xact_rollback, d.blks_hit, d.blks_read,
             d.tup_inserted, d.tup_updated, d.tup_deleted, d.tup_fetched,
             d.deadlocks, d.temp_bytes, d.stats_reset
      from (select 1) one
      left join pg_stat_database d on d.datname = current_database()
      cross join lateral (
        select count(*) as total,
               count(*) filter (where state = 'active') as active,
               count(*) filter (where state = 'idle') as idle,
               count(*) filter (where state like 'idle in transaction%') as idle_tx
        from pg_stat_activity
        where datname = current_database() and backend_type = 'client backend'
      ) a`),
    ctx.pool.query<TableRow>(`
      select n.nspname as schema, c.relname as name, c.relkind as kind,
             coalesce(s.n_live_tup, greatest(c.reltuples, 0))::bigint as rows,
             s.n_dead_tup as dead_rows,
             pg_table_size(c.oid) as table_bytes,
             pg_indexes_size(c.oid) as index_bytes,
             pg_total_relation_size(c.oid) as total_bytes,
             (select count(*) from pg_index i where i.indrelid = c.oid) as index_count,
             s.seq_scan, s.idx_scan,
             greatest(s.last_vacuum, s.last_autovacuum) as last_vacuum,
             greatest(s.last_analyze, s.last_autoanalyze) as last_analyze
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_stat_user_tables s on s.relid = c.oid
      where c.relkind in ('r', 'v', 'm', 'p', 'f')
        and not c.relispartition
        and n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname not like 'pg\\_toast%'
        and n.nspname not like 'pg\\_temp%'
      order by pg_total_relation_size(c.oid) desc, n.nspname, c.relname`),
    ctx.pool.query<{ name: string; version: string }>(
      `select extname as name, extversion as version from pg_extension where extname <> 'plpgsql' order by extname`,
    ),
  ]);

  const d = db.rows[0]!;
  const hit = num(d.blks_hit);
  const read = num(d.blks_read);

  return {
    sizeBytes: num(d.size_bytes),
    uptimeSeconds: num(d.uptime_seconds),
    serverVersion: d.server_version,
    connections: {
      total: num(d.conn_total),
      active: num(d.conn_active),
      idle: num(d.conn_idle),
      idleInTransaction: num(d.conn_idle_tx),
      max: d.max_connections,
    },
    cacheHitRatio: hit + read > 0 ? hit / (hit + read) : null,
    transactions: { commits: num(d.xact_commit), rollbacks: num(d.xact_rollback) },
    tuples: {
      inserted: num(d.tup_inserted),
      updated: num(d.tup_updated),
      deleted: num(d.tup_deleted),
      fetched: num(d.tup_fetched),
    },
    deadlocks: num(d.deadlocks),
    tempBytes: num(d.temp_bytes),
    statsSince: iso(d.stats_reset),
    extensions: extensions.rows,
    tables: tables.rows.map((t): TableStats => ({
      schema: t.schema,
      name: t.name,
      kind: t.kind,
      rows: num(t.rows),
      deadRows: num(t.dead_rows),
      tableBytes: num(t.table_bytes),
      indexBytes: num(t.index_bytes),
      totalBytes: num(t.total_bytes),
      indexCount: num(t.index_count),
      seqScans: numOrNull(t.seq_scan),
      indexScans: numOrNull(t.idx_scan),
      lastVacuum: iso(t.last_vacuum),
      lastAnalyze: iso(t.last_analyze),
    })),
  };
}
