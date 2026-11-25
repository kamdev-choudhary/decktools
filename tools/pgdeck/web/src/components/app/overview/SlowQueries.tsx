import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gauge, MoreHorizontal, Route, RotateCcw, SquareTerminal } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { StatementSort, StatementStat } from '@shared/types';
import { api } from '@/api/client';
import { keys } from '@/api/hooks';
import { Button } from '@deck/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@deck/ui/components/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deck/ui/components/select';
import { formatPercent } from '@/lib/format';
import { openInSqlEditor } from '@/lib/sql-draft';
import { cn } from '@deck/ui/lib/utils';
import { errorMessage, ErrorAlert, Spinner } from '../feedback';
import { TruncatedText } from '@deck/ui/components/truncated-text';

const SORTS: { value: StatementSort; label: string }[] = [
  { value: 'total', label: 'Total time' },
  { value: 'mean', label: 'Time per call' },
  { value: 'calls', label: 'Calls' },
  { value: 'rows', label: 'Rows' },
];

const ms = (v: number) =>
  v >= 60_000
    ? `${(v / 60_000).toFixed(1)} min`
    : v >= 1000
      ? `${(v / 1000).toFixed(1)} s`
      : `${v.toFixed(v < 10 ? 2 : 0)} ms`;
const int = (v: number) =>
  v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : Math.round(v).toLocaleString();

/** The most expensive statements from pg_stat_statements, with a way to explain them. */
export function SlowQueries({ db, readonly }: { db: string; readonly: boolean }) {
  const qc = useQueryClient();
  const [sort, setSort] = useState<StatementSort>('total');
  const key = [...keys.db(db), 'statements', sort];
  const q = useQuery({ queryKey: key, queryFn: () => api.statements(db, sort), refetchInterval: 15_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: [...keys.db(db), 'statements'] });

  const enable = useMutation({
    mutationFn: () => api.enableStatements(db),
    onSuccess: (r) => (toast.success(r.message), void refresh()),
    onError: (e) => toast.error('Could not enable pg_stat_statements', { description: errorMessage(e) }),
  });
  const reset = useMutation({
    mutationFn: () => api.resetStatements(db),
    onSuccess: (r) => (toast.success(r.message), void refresh()),
    onError: (e) => toast.error('Could not reset statistics', { description: errorMessage(e) }),
  });

  const data = q.data;
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Gauge className="size-4 text-muted-foreground" />
          Slowest queries
        </h2>
        <span className="text-xs text-muted-foreground">from pg_stat_statements</span>
        {data?.status === 'ok' && (
          <div className="ml-auto flex items-center gap-2">
            <Select value={sort} onValueChange={(v) => setSort(v as StatementSort)}>
              <SelectTrigger size="sm" className="h-8 w-auto gap-2 text-xs" aria-label="Sort by">
                <span className="text-muted-foreground">By</span> <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value} className="text-xs">
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!readonly && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={reset.isPending}
                onClick={() => reset.mutate()}
                title="Start collecting statistics from zero"
              >
                <RotateCcw /> Reset
              </Button>
            )}
          </div>
        )}
      </div>

      {q.isPending && (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      )}
      {q.isError && <ErrorAlert error={q.error} className="m-4 w-auto" />}
      {data && data.status !== 'ok' && (
        <Setup status={data.status} readonly={readonly} enabling={enable.isPending} onEnable={() => enable.mutate()} />
      )}
      {data?.status === 'ok' && !data.statements.length && (
        <p className="p-6 text-center text-sm text-muted-foreground">
          No statements recorded for this database yet. They appear as soon as queries run.
        </p>
      )}
      {data?.status === 'ok' && data.statements.length > 0 && (
        <div className="max-h-[26rem] overflow-auto">
          <table className="w-full min-w-[44rem] table-fixed text-sm">
            <colgroup>
              <col />
              <col className="w-36" />
              <col className="w-24" />
              <col className="w-24" />
              <col className="w-20" />
              <col className="w-20" />
              <col className="w-12" />
            </colgroup>
            <thead className="sticky top-0 border-b bg-grid-header text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">Query</th>
                <th className="px-3 py-2 font-medium">Total time</th>
                <th className="px-3 py-2 text-right font-medium">Per call</th>
                <th className="px-3 py-2 text-right font-medium">Calls</th>
                <th className="px-3 py-2 text-right font-medium">Rows</th>
                <th className="px-3 py-2 text-right font-medium" title="Share of blocks found in shared buffers">
                  Cache
                </th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.statements.map((s) => (
                <StatementRow key={s.id} s={s} share={data.totalMs > 0 ? s.totalMs / data.totalMs : 0} db={db} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatementRow({ s, share, db }: { s: StatementStat; share: number; db: string }) {
  const oneLine = s.query.replace(/\s+/g, ' ').trim();
  return (
    <tr className="group hover:bg-muted/40">
      <td className="px-4 py-2">
        <TruncatedText
          text={oneLine}
          tooltip={<pre className="max-h-80 overflow-auto font-mono whitespace-pre-wrap">{s.query}</pre>}
          className="font-mono text-xs"
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-chart-data"
              style={{ width: `${Math.max(1, Math.round(share * 100))}%` }}
            />
          </div>
          <span className="w-14 shrink-0 text-right text-xs tabular-nums">{ms(s.totalMs)}</span>
        </div>
      </td>
      <td className="px-3 py-2 text-right text-xs tabular-nums">{ms(s.meanMs)}</td>
      <td className="px-3 py-2 text-right text-xs text-muted-foreground tabular-nums">{int(s.calls)}</td>
      <td className="px-3 py-2 text-right text-xs text-muted-foreground tabular-nums">{int(s.rows)}</td>
      <td
        className={cn(
          'px-3 py-2 text-right text-xs tabular-nums',
          s.cacheHitRatio !== null && s.cacheHitRatio < 0.9 ? 'text-warning' : 'text-muted-foreground',
        )}
      >
        {s.cacheHitRatio === null ? '—' : formatPercent(s.cacheHitRatio)}
      </td>
      <td className="px-2 py-1.5 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Query actions" className="text-muted-foreground">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => openInSqlEditor(db, s.query, { explain: true })}>
              <Route /> Explain
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openInSqlEditor(db, s.query)}>
              <SquareTerminal /> Open in SQL editor
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

function Setup({
  status,
  readonly,
  enabling,
  onEnable,
}: {
  status: 'not-created' | 'not-preloaded' | 'unavailable';
  readonly: boolean;
  enabling: boolean;
  onEnable: () => void;
}) {
  if (status === 'not-created') {
    return (
      <div className="flex flex-wrap items-center gap-4 p-5 text-sm">
        <p className="min-w-0 flex-1 text-muted-foreground">
          The server collects query statistics, but the{' '}
          <span className="font-mono text-foreground">pg_stat_statements</span> extension isn't created in this database
          yet.
        </p>
        {!readonly && (
          <Button size="sm" disabled={enabling} onClick={onEnable}>
            {enabling && <Spinner className="text-current" />}
            Enable for this database
          </Button>
        )}
      </div>
    );
  }
  if (status === 'unavailable') {
    return (
      <p className="p-5 text-sm text-muted-foreground">
        This server doesn't have the <span className="font-mono text-foreground">pg_stat_statements</span> extension
        installed. It ships in PostgreSQL's contrib package (often <span className="font-mono">postgresql-contrib</span>
        ).
      </p>
    );
  }
  return (
    <div className="space-y-3 p-5 text-sm">
      <p className="text-muted-foreground">
        To see which queries take the most time, turn on{' '}
        <span className="font-mono text-foreground">pg_stat_statements</span>. It needs a server restart once:
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
        <li>
          Add it to <span className="font-mono text-foreground">postgresql.conf</span>:
          <pre className="mt-1.5 w-fit rounded-md border bg-muted/40 px-3 py-1.5 font-mono text-xs text-foreground">
            shared_preload_libraries = 'pg_stat_statements'
          </pre>
        </li>
        <li>Restart PostgreSQL.</li>
        <li>
          Come back here and choose Enable, or run{' '}
          <span className="font-mono text-foreground">CREATE EXTENSION pg_stat_statements;</span>
        </li>
      </ol>
    </div>
  );
}
