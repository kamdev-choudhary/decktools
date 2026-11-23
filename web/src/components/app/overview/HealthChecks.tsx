import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { DbStats } from '@shared/types';
import { formatBytes, formatNumber, formatPercent } from '@/lib/format';
import { tableHref } from '@/lib/router';

interface Finding {
  title: string;
  detail: string;
  tables?: { schema: string; name: string }[];
}

const MB = 1024 * 1024;

/** Simple, explainable heuristics over pg_stat counters. */
function findings(stats: DbStats): Finding[] {
  const out: Finding[] = [];
  const tables = stats.tables.filter((t) => t.kind === 'r' || t.kind === 'p');

  if (stats.cacheHitRatio !== null && stats.cacheHitRatio < 0.99 && stats.transactions.commits > 1000) {
    out.push({
      title: `Cache hit ratio is ${formatPercent(stats.cacheHitRatio)}`,
      detail: 'Below 99% means many reads go to disk. Consider more shared_buffers or reviewing heavy queries.',
    });
  }

  if (stats.connections.idleInTransaction > 0) {
    out.push({
      title: `${stats.connections.idleInTransaction} connection(s) idle in transaction`,
      detail: 'Open transactions hold locks and block vacuum. Check for clients that forget to commit.',
    });
  }

  const bloated = tables.filter((t) => t.deadRows > 1000 && t.deadRows / (t.rows + t.deadRows) > 0.2);
  if (bloated.length) {
    out.push({
      title: `${bloated.length} table(s) with many dead rows`,
      detail: 'Over 20% dead tuples. VACUUM (or tuning autovacuum) would reclaim space.',
      tables: bloated,
    });
  }

  const seqHeavy = tables.filter((t) => t.rows > 10_000 && (t.seqScans ?? 0) > 10 * Math.max(t.indexScans ?? 0, 1));
  if (seqHeavy.length) {
    out.push({
      title: `${seqHeavy.length} large table(s) mostly read by sequential scans`,
      detail: 'Over 10k rows and far more seq scans than index scans. They may be missing an index.',
      tables: seqHeavy,
    });
  }

  const indexHeavy = tables.filter((t) => t.indexBytes > MB && t.indexBytes > 3 * t.tableBytes);
  if (indexHeavy.length) {
    out.push({
      title: `${indexHeavy.length} table(s) with indexes 3× larger than the data`,
      detail: `Unused or overlapping indexes slow down writes. ${formatBytes(indexHeavy.reduce((s, t) => s + t.indexBytes, 0))} of index on these.`,
      tables: indexHeavy,
    });
  }

  const neverAnalyzed = tables.filter((t) => !t.lastAnalyze && t.rows > 0);
  if (neverAnalyzed.length) {
    out.push({
      title: `${formatNumber(neverAnalyzed.length)} table(s) never analyzed`,
      detail: 'The planner has no statistics for them. Run ANALYZE so queries get good plans.',
      tables: neverAnalyzed,
    });
  }

  if (stats.deadlocks > 0) {
    out.push({
      title: `${formatNumber(stats.deadlocks)} deadlock(s) recorded`,
      detail: 'Transactions locked each other and one was aborted. Check the server log for the queries involved.',
    });
  }

  return out;
}

export function HealthChecks({ db, stats }: { db: string; stats: DbStats }) {
  const list = findings(stats);

  if (!list.length) {
    return (
      <div className="flex items-start gap-3 rounded-md p-1 text-sm">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
        <div>
          <div className="font-medium">No issues found</div>
          <p className="text-muted-foreground">Cache, connections, vacuum and index usage all look healthy.</p>
        </div>
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {list.map((f) => (
        <li key={f.title} className="flex items-start gap-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Warning" />
          <div className="min-w-0 space-y-1">
            <div className="font-medium">{f.title}</div>
            <p className="text-xs text-muted-foreground">{f.detail}</p>
            {f.tables && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {f.tables.slice(0, 5).map((t) => (
                  <a
                    key={`${t.schema}.${t.name}`}
                    href={tableHref(db, t.schema, t.name)}
                    className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {t.name}
                  </a>
                ))}
                {f.tables.length > 5 && <span className="px-1 py-0.5 text-[11px] text-muted-foreground">+{f.tables.length - 5} more</span>}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
