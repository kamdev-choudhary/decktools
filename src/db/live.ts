import type { LiveActivity, LiveSample } from '../shared/types.js';
import type { DbContext } from './client.js';

interface Counters {
  t: number;
  commits: number;
  rollbacks: number;
  blksHit: number;
  blksRead: number;
  rowsRead: number;
  rowsWritten: number;
}

interface CounterRow {
  xact_commit: string;
  xact_rollback: string;
  blks_hit: string;
  blks_read: string;
  rows_read: string;
  rows_written: string;
}

interface ConnRow {
  total: string;
  active: string;
  idle: string;
  idle_tx: string;
  max: number;
}

interface ActivityRow {
  pid: number;
  user: string | null;
  application: string;
  client: string | null;
  state: string | null;
  wait_event: string | null;
  duration_seconds: number | null;
  query: string;
}

/**
 * Samples pg_stat_database / pg_stat_activity and turns the cumulative
 * counters into per-second rates between consecutive calls.
 */
export function createLiveSampler(ctx: DbContext) {
  let prev: Counters | null = null;

  return async function sample(): Promise<LiveSample> {
    const [counters, conns, activity] = await Promise.all([
      ctx.pool.query<CounterRow>(`
        select xact_commit, xact_rollback, blks_hit, blks_read,
               tup_returned + tup_fetched as rows_read,
               tup_inserted + tup_updated + tup_deleted as rows_written
        from pg_stat_database where datname = current_database()`),
      ctx.pool.query<ConnRow>(`
        select count(*) as total,
               count(*) filter (where state = 'active') as active,
               count(*) filter (where state = 'idle') as idle,
               count(*) filter (where state like 'idle in transaction%') as idle_tx,
               current_setting('max_connections')::int as max
        from pg_stat_activity
        where datname = current_database() and backend_type = 'client backend'`),
      ctx.pool.query<ActivityRow>(`
        select pid, usename as "user", application_name as application,
               host(client_addr) as client, state, wait_event_type as wait_event,
               extract(epoch from now() - coalesce(query_start, xact_start, backend_start))::float8 as duration_seconds,
               left(query, 500) as query
        from pg_stat_activity
        where datname = current_database()
          and backend_type = 'client backend'
          and pid <> pg_backend_pid()
          and application_name <> 'pgdeck'
        order by (state = 'active') desc, query_start desc nulls last
        limit 50`),
    ]);

    const c = counters.rows[0];
    const now: Counters = {
      t: Date.now(),
      commits: Number(c?.xact_commit ?? 0),
      rollbacks: Number(c?.xact_rollback ?? 0),
      blksHit: Number(c?.blks_hit ?? 0),
      blksRead: Number(c?.blks_read ?? 0),
      rowsRead: Number(c?.rows_read ?? 0),
      rowsWritten: Number(c?.rows_written ?? 0),
    };

    // Capture the previous sample before replacing it: the rates below compare against it.
    const last = prev;
    prev = now;
    const secs = last ? Math.max((now.t - last.t) / 1000, 0.001) : 1;
    // Counters can go backwards after pg_stat_reset(); clamp rates at 0.
    const rate = (key: keyof Omit<Counters, 't'>) => (last ? Math.max(now[key] - last[key], 0) / secs : 0);
    const hit = last ? Math.max(now.blksHit - last.blksHit, 0) : 0;
    const read = last ? Math.max(now.blksRead - last.blksRead, 0) : 0;

    const k = conns.rows[0]!;
    return {
      type: 'sample',
      t: now.t,
      connections: {
        total: Number(k.total),
        active: Number(k.active),
        idle: Number(k.idle),
        idleInTransaction: Number(k.idle_tx),
        max: k.max,
      },
      commitsPerSec: rate('commits'),
      rollbacksPerSec: rate('rollbacks'),
      rowsReadPerSec: rate('rowsRead'),
      rowsWrittenPerSec: rate('rowsWritten'),
      cacheHitRatio: hit + read > 0 ? hit / (hit + read) : null,
      activity: activity.rows.map(
        (a): LiveActivity => ({
          pid: a.pid,
          user: a.user,
          application: a.application,
          client: a.client,
          state: a.state,
          waitEvent: a.wait_event,
          durationSeconds: a.duration_seconds,
          query: a.query,
        }),
      ),
    };
  };
}
