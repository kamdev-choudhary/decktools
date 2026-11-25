import { Activity, Cpu, Gauge, MemoryStick, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { LiveChart } from '@deck/ui/components/live-chart';
import { StatTile } from '@deck/ui/components/stat-tile';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deck/ui/components/table';
import { STATS_WINDOW, useLiveStats, useServer, useSlowlog } from '@/api/hooks';
import { CenteredSpinner, ErrorAlert } from '@/components/feedback';
import { formatBytes, formatCompact, formatDuration, formatNumber, formatRelative } from '@/lib/format';
import { keysHref } from '@/lib/router';

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium tabular-nums">{children}</span>
    </div>
  );
}

export function ServerView() {
  const server = useServer();
  const live = useLiveStats();
  const slow = useSlowlog();

  if (server.isPending) return <CenteredSpinner label="Loading server info…" />;
  if (server.isError) return <ErrorAlert error={server.error} className="m-6 w-auto" />;
  const s = server.data;

  const latest = live.latest;
  const times = live.samples.map((x) => x.t);
  // Hit ratio over the sampled window, from the cumulative counters.
  const first = live.samples[0];
  const hits = latest && first ? latest.keyspaceHits - first.keyspaceHits : 0;
  const misses = latest && first ? latest.keyspaceMisses - first.keyspaceMisses : 0;
  const lifetimeRatio = s.keyspaceHits + s.keyspaceMisses ? s.keyspaceHits / (s.keyspaceHits + s.keyspaceMisses) : null;
  const windowRatio = hits + misses ? hits / (hits + misses) : null;
  const ratio = windowRatio ?? lifetimeRatio;
  const memory = latest?.usedMemory ?? s.usedMemory;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-8 p-4 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {s.product === 'redis' ? 'Redis' : s.product} {s.version}
            </h1>
            <p className="text-sm text-muted-foreground">
              {s.host}:{s.port} · {s.mode} · {s.role} · up {formatDuration(s.uptimeSeconds)}
            </p>
          </div>
          {live.error && <p className="text-xs text-destructive">Live stats paused: {live.error}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Operations / s" icon={Activity} value={latest ? formatNumber(latest.opsPerSec) : undefined} detail={`${formatCompact(s.totalCommands)} commands since start`} />
          <StatTile
            label="Memory"
            icon={MemoryStick}
            value={formatBytes(memory)}
            meter={s.maxMemory ? memory / s.maxMemory : undefined}
            meterTone={s.maxMemory && memory / s.maxMemory > 0.9 ? 'warning' : 'neutral'}
            detail={s.maxMemory ? `of ${formatBytes(s.maxMemory)} · ${s.maxMemoryPolicy}` : `peak ${formatBytes(s.peakMemory)} · no maxmemory set`}
          />
          <StatTile label="Clients" icon={Users} value={formatNumber(latest?.clients ?? s.connectedClients)} detail={`${s.connectedReplicas} replica${s.connectedReplicas === 1 ? '' : 's'} connected`} />
          <StatTile
            label="Cache hit ratio"
            icon={Gauge}
            value={ratio === null ? '–' : `${(ratio * 100).toFixed(1)}%`}
            meter={ratio ?? undefined}
            meterTone={ratio !== null && ratio < 0.8 ? 'warning' : 'good'}
            detail={windowRatio !== null ? 'over the last few minutes' : 'since start'}
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <LiveChart
              title="Operations per second"
              times={times}
              slots={STATS_WINDOW}
              series={[{ name: 'ops/s', color: 'var(--chart-data)', values: live.samples.map((x) => x.opsPerSec) }]}
              format={(v) => formatCompact(v)}
            />
          <LiveChart
              title="Network (kB/s)"
              times={times}
              slots={STATS_WINDOW}
              series={[
                { name: 'in', color: 'var(--chart-data)', values: live.samples.map((x) => x.inputKbps) },
                { name: 'out', color: 'var(--chart-index)', values: live.samples.map((x) => x.outputKbps) },
              ]}
              format={(v) => formatCompact(v)}
            />
          <LiveChart
              className="lg:col-span-2"
              title="Memory used"
              times={times}
              slots={STATS_WINDOW}
              series={[{ name: 'memory', color: 'var(--chart-data)', values: live.samples.map((x) => x.usedMemory) }]}
              format={formatBytes}
            />
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          <Section title="Keyspace" description="Databases that hold keys.">
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-grid-header">
                    <TableHead>Database</TableHead>
                    <TableHead className="text-right">Keys</TableHead>
                    <TableHead className="text-right">With expiry</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.keyspace.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                        Every database is empty.
                      </TableCell>
                    </TableRow>
                  )}
                  {s.keyspace.map((d) => (
                    <TableRow key={d.index}>
                      <TableCell className="font-mono">
                        <a href={keysHref(d.index)} className="text-link hover:underline">
                          db{d.index}
                        </a>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(d.keys)}</TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">{formatNumber(d.expires)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Section>

          <Section title="Server">
            <div className="rounded-lg border px-4 py-1">
              <Fact label="Operating system">{s.os || '–'}</Fact>
              <Fact label="Eviction policy">{s.maxMemoryPolicy || '–'}</Fact>
              <Fact label="Fragmentation">{s.fragmentation?.toFixed(2) ?? '–'}</Fact>
              <Fact label="Expired / evicted keys">
                {formatNumber(s.expiredKeys)} / {formatNumber(s.evictedKeys)}
              </Fact>
              <Fact label="Persistence">
                {s.aofEnabled ? 'AOF on' : 'AOF off'}
                {s.rdbLastSave ? ` · last RDB save ${formatRelative(s.rdbLastSave)}` : ''}
              </Fact>
              <Fact label="Changes since last save">{formatNumber(s.rdbChangesSinceSave)}</Fact>
              <Fact label="Modules">{s.modules.length ? s.modules.join(', ') : 'none'}</Fact>
            </div>
          </Section>
        </div>

        <Section title="Slow log" description="The slowest recent commands, as recorded by SLOWLOG.">
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-grid-header">
                  <TableHead className="w-28">When</TableHead>
                  <TableHead className="w-24 text-right">Duration</TableHead>
                  <TableHead>Command</TableHead>
                  <TableHead className="hidden w-44 md:table-cell">Client</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slow.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                      <Cpu className="mx-auto mb-2 size-4" />
                      Nothing slow recorded (or SLOWLOG isn't available on this server).
                    </TableCell>
                  </TableRow>
                )}
                {slow.data?.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-muted-foreground">{formatRelative(e.at)}</TableCell>
                    <TableCell className="text-right tabular-nums">{e.micros >= 1000 ? `${(e.micros / 1000).toFixed(1)} ms` : `${e.micros} µs`}</TableCell>
                    <TableCell className="max-w-0 truncate font-mono text-[12.5px]" title={e.command}>
                      {e.command}
                    </TableCell>
                    <TableCell className="hidden truncate font-mono text-xs text-muted-foreground md:table-cell">{e.client}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
      </div>
    </div>
  );
}
