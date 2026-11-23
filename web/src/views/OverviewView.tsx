import { Activity, Database, Plus, Gauge, HardDrive, RefreshCw, SquareTerminal, Users, type LucideIcon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useInfo, useStats, keys } from '@/api/hooks';
import { useLive, type LiveStatus } from '@/api/live';
import { CenteredSpinner, ErrorAlert } from '@/components/app/feedback';
import { DatabaseActionsMenu } from '@/components/app/DatabaseActions';
import { CreateTableDialog } from '@/components/app/CreateTableDialog';
import { ActiveSessions } from '@/components/app/overview/ActiveSessions';
import { SlowQueries } from '@/components/app/overview/SlowQueries';
import { HealthChecks } from '@/components/app/overview/HealthChecks';
import { LiveChart } from '@/components/app/overview/LiveChart';
import { StatTile } from '@/components/app/overview/StatTile';
import { StorageChart } from '@/components/app/overview/StorageChart';
import { TablesTable } from '@/components/app/overview/TablesTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatBytes, formatCompact, formatDuration, formatNumber, formatPercent } from '@/lib/format';
import { sqlHref } from '@/lib/router';
import { cn } from '@/lib/utils';

function LiveBadge({ status }: { status: LiveStatus }) {
  const label = status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Reconnecting';
  return (
    <span className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium">
      <span className="relative flex size-2">
        {status === 'live' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />}
        <span className={cn('relative inline-flex size-2 rounded-full', status === 'live' ? 'bg-success' : 'bg-warning')} />
      </span>
      {label}
    </span>
  );
}

function Fact({ label, value, icon: Icon }: { label: string; value: string; icon?: LucideIcon }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="size-3" />}
        {label}
      </div>
      <div className="mt-1 truncate text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Card({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border bg-card', className)}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {aside}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

const perSec = (v: number) => (v >= 100 ? formatCompact(v) : v.toFixed(v < 10 ? 1 : 0));

export function OverviewView({ db }: { db: string }) {
  const qc = useQueryClient();
  const info = useInfo(db);
  const stats = useStats(db);
  const live = useLive(db);
  const [newTable, setNewTable] = useState(false);
  const s = stats.data;
  const l = live.latest;

  const derived = useMemo(() => {
    if (!s) return null;
    const tables = s.tables.filter((t) => t.kind !== 'v' && t.kind !== 'm');
    return {
      tables: tables.length,
      views: s.tables.length - tables.length,
      schemas: new Set(s.tables.map((t) => t.schema)).size,
      rows: tables.reduce((n, t) => n + t.rows, 0),
      indexes: s.tables.reduce((n, t) => n + t.indexCount, 0),
      dataBytes: s.tables.reduce((n, t) => n + t.tableBytes, 0),
      indexBytes: s.tables.reduce((n, t) => n + t.indexBytes, 0),
    };
  }, [s]);

  const conns = l?.connections ?? s?.connections;
  const cache = l?.cacheHitRatio ?? s?.cacheHitRatio ?? null;
  const rollbackShare = s && s.transactions.commits + s.transactions.rollbacks > 0
    ? s.transactions.rollbacks / (s.transactions.commits + s.transactions.rollbacks)
    : 0;

  const times = live.samples.map((x) => x.t);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-8">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{db}</h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {s && <Badge variant="secondary">PostgreSQL {s.serverVersion.split(' ')[0]}</Badge>}
              {info.data && (
                <span className="font-mono">
                  {info.data.user}@{info.data.host ?? 'local'}
                  {info.data.port ? `:${info.data.port}` : ''}
                </span>
              )}
              {s && <span>· up {formatDuration(s.uptimeSeconds)}</span>}
              {s && s.extensions.length > 0 && (
                <span title={s.extensions.map((e) => `${e.name} ${e.version}`).join(', ')}>
                  · {s.extensions.length} extension{s.extensions.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LiveBadge status={live.status} />
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Refresh statistics"
              onClick={() => qc.invalidateQueries({ queryKey: keys.stats(db) })}
              disabled={stats.isFetching}
            >
              <RefreshCw className={cn(stats.isFetching && 'animate-spin')} />
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={sqlHref(db)}>
                <SquareTerminal /> SQL Editor
              </a>
            </Button>
            {info.data && !info.data.readonly && (
              <Button size="sm" onClick={() => setNewTable(true)}>
                <Plus /> New table
              </Button>
            )}
            <DatabaseActionsMenu db={db} />
          </div>
          {newTable && <CreateTableDialog db={db} onClose={() => setNewTable(false)} />}
        </div>

        {stats.isError && <ErrorAlert error={stats.error} title="Could not load statistics" />}
        {live.error && <ErrorAlert error={new Error(live.error)} title="Live metrics unavailable" />}

        {/* Headline KPIs */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Connections"
            icon={Users}
            value={conns ? `${conns.total} / ${conns.max}` : undefined}
            meter={conns ? conns.total / conns.max : undefined}
            meterTone={conns && conns.total / conns.max > 0.8 ? 'warning' : 'neutral'}
            detail={conns && `${conns.active} active · ${conns.idle} idle · ${conns.idleInTransaction} idle in tx`}
          />
          <StatTile
            label="Transactions / s"
            icon={Activity}
            value={l ? perSec(l.commitsPerSec + l.rollbacksPerSec) : s ? '—' : undefined}
            detail={s && `${formatCompact(s.transactions.commits)} committed · ${formatPercent(rollbackShare)} rolled back`}
          />
          <StatTile
            label="Cache hit ratio"
            icon={Gauge}
            value={s ? (cache === null ? '—' : formatPercent(cache, 2)) : undefined}
            meter={cache ?? undefined}
            meterTone={cache === null ? 'neutral' : cache >= 0.99 ? 'good' : 'warning'}
            detail={cache === null ? 'No block reads yet' : cache >= 0.99 ? 'Healthy (≥ 99%)' : 'Below 99%: reads going to disk'}
          />
          <StatTile
            label="Database size"
            icon={HardDrive}
            value={s ? formatBytes(s.sizeBytes) : undefined}
            detail={derived && `${formatBytes(derived.dataBytes)} data · ${formatBytes(derived.indexBytes)} indexes`}
          />
        </div>

        {/* Facts strip */}
        <div className="grid grid-cols-2 divide-x divide-y overflow-hidden rounded-lg border bg-card sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6">
          <Fact label="Tables" icon={Database} value={derived ? formatNumber(derived.tables) : '—'} />
          <Fact label="Views" value={derived ? formatNumber(derived.views) : '—'} />
          <Fact label="Schemas" value={derived ? formatNumber(derived.schemas) : '—'} />
          <Fact label="Rows (est.)" value={derived ? formatCompact(derived.rows) : '—'} />
          <Fact label="Indexes" value={derived ? formatNumber(derived.indexes) : '—'} />
          <Fact label="Deadlocks" value={s ? formatNumber(s.deadlocks) : '—'} />
        </div>

        {/* Live charts */}
        <div className="grid gap-3 lg:grid-cols-2">
          <LiveChart
            title="Transactions / s"
            times={times}
            slots={live.window}
            format={perSec}
            series={[
              { name: 'Commits', color: 'var(--chart-data)', values: live.samples.map((x) => x.commitsPerSec) },
              { name: 'Rollbacks', color: 'var(--chart-index)', values: live.samples.map((x) => x.rollbacksPerSec) },
            ]}
          />
          <LiveChart
            title="Rows / s"
            times={times}
            slots={live.window}
            format={perSec}
            series={[
              { name: 'Read', color: 'var(--chart-data)', values: live.samples.map((x) => x.rowsReadPerSec) },
              { name: 'Written', color: 'var(--chart-index)', values: live.samples.map((x) => x.rowsWrittenPerSec) },
            ]}
          />
        </div>

        <ActiveSessions db={db} readonly={info.data?.readonly ?? true} activity={l?.activity ?? []} ready={!!l} />

        <SlowQueries db={db} readonly={info.data?.readonly ?? true} />

        {/* Storage + health */}
        {stats.isPending ? (
          <CenteredSpinner label="Collecting statistics…" />
        ) : s ? (
          <>
            <div className="grid gap-3 lg:grid-cols-3">
              <Card title="Storage" aside={<span className="text-xs text-muted-foreground">Largest relations</span>} className="lg:col-span-2">
                <StorageChart db={db} tables={s.tables} />
              </Card>
              <Card title="Health checks">
                <HealthChecks db={db} stats={s} />
              </Card>
            </div>
            <TablesTable db={db} tables={s.tables} />
          </>
        ) : null}
      </div>
    </div>
  );
}
