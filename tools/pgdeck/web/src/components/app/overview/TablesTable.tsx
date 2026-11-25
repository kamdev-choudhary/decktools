import { ArrowDown, ArrowUp, Eye, Layers, Search, Table2, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { RelKind, TableStats } from '@shared/types';
import { Badge } from '@deck/ui/components/badge';
import { Input } from '@deck/ui/components/input';
import { formatBytes, formatCompact, formatNumber, formatPercent, formatRelative } from '@/lib/format';
import { navigate, tableHref } from '@/lib/router';
import { cn } from '@deck/ui/lib/utils';
import { TruncatedText } from '@deck/ui/components/truncated-text';

const KIND_ICON: Record<RelKind, LucideIcon> = { r: Table2, p: Table2, f: Table2, v: Eye, m: Layers };

type SortKey = 'name' | 'rows' | 'size' | 'indexes' | 'dead' | 'analyzed';
type KindFilter = 'all' | 'tables' | 'views';

const deadRatio = (t: TableStats) => (t.rows + t.deadRows > 0 ? t.deadRows / (t.rows + t.deadRows) : 0);

const SORTERS: Record<SortKey, (a: TableStats, b: TableStats) => number> = {
  name: (a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`),
  rows: (a, b) => a.rows - b.rows,
  size: (a, b) => a.totalBytes - b.totalBytes,
  indexes: (a, b) => a.indexBytes - b.indexBytes,
  dead: (a, b) => deadRatio(a) - deadRatio(b),
  analyzed: (a, b) => (a.lastAnalyze ?? '').localeCompare(b.lastAnalyze ?? ''),
};

function SortHeader({
  label,
  k,
  sort,
  onSort,
  align = 'right',
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sort.key === k;
  const Icon = sort.desc ? ArrowDown : ArrowUp;
  return (
    <th className={cn('px-4 py-2.5 font-medium whitespace-nowrap', align === 'right' ? 'text-right' : 'text-left')}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn('inline-flex items-center gap-1 hover:text-foreground', active && 'text-foreground')}
        aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : undefined}
      >
        {label}
        <Icon className={cn('size-3', active ? 'opacity-100' : 'opacity-0')} />
      </button>
    </th>
  );
}

export function TablesTable({ db, tables }: { db: string; tables: TableStats[] }) {
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'size', desc: true });

  const maxBytes = Math.max(...tables.map((t) => t.totalBytes), 1);
  const viewCount = tables.filter((t) => t.kind === 'v' || t.kind === 'm').length;

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = tables.filter((t) => {
      const isView = t.kind === 'v' || t.kind === 'm';
      if (kind === 'tables' && isView) return false;
      if (kind === 'views' && !isView) return false;
      return !needle || `${t.schema}.${t.name}`.toLowerCase().includes(needle);
    });
    const cmp = SORTERS[sort.key];
    return list.sort((a, b) => (sort.desc ? -cmp(a, b) : cmp(a, b)));
  }, [tables, filter, kind, sort]);

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== 'name' }));

  const kinds: [KindFilter, string, number][] = [
    ['all', 'All', tables.length],
    ['tables', 'Tables', tables.length - viewCount],
    ['views', 'Views', viewCount],
  ];

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="inline-flex rounded-md border p-0.5 text-xs">
          {kinds.map(([k, label, count]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                'rounded-[5px] px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground',
                kind === k && 'bg-accent text-foreground',
              )}
            >
              {label} <span className="tabular-nums opacity-60">{count}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tables…"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-grid-header text-xs text-muted-foreground">
            <tr>
              <SortHeader label="Name" k="name" sort={sort} onSort={onSort} align="left" />
              <SortHeader label="Rows" k="rows" sort={sort} onSort={onSort} />
              <SortHeader label="Size" k="size" sort={sort} onSort={onSort} align="left" />
              <SortHeader label="Indexes" k="indexes" sort={sort} onSort={onSort} />
              <SortHeader label="Dead rows" k="dead" sort={sort} onSort={onSort} />
              <SortHeader label="Last analyzed" k="analyzed" sort={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((t) => {
              const Icon = KIND_ICON[t.kind];
              const href = tableHref(db, t.schema, t.name);
              const dead = deadRatio(t);
              return (
                <tr
                  key={`${t.schema}.${t.name}`}
                  className="cursor-pointer transition-colors hover:bg-muted/40"
                  onClick={() => navigate(href)}
                >
                  <td className="max-w-72 px-4 py-2.5">
                    <a href={href} className="flex min-w-0 items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <TruncatedText text={t.name} tooltip={`${t.schema}.${t.name}`} className="font-medium" />
                      {t.schema !== 'public' && (
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {t.schema}
                        </Badge>
                      )}
                    </a>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums" title={formatNumber(t.rows)}>
                    {formatCompact(t.rows)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
                        <div
                          className="bg-chart-data h-full rounded-full"
                          style={{ width: `${(t.totalBytes / maxBytes) * 100}%` }}
                        />
                      </div>
                      <span className="text-muted-foreground tabular-nums">{formatBytes(t.totalBytes)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap text-muted-foreground tabular-nums">
                    {t.indexCount} · {formatBytes(t.indexBytes)}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-2.5 text-right tabular-nums',
                      dead > 0.2 && t.deadRows > 1000 ? 'text-warning' : 'text-muted-foreground',
                    )}
                  >
                    {t.deadRows ? `${formatCompact(t.deadRows)} (${formatPercent(dead, 0)})` : '—'}
                  </td>
                  <td
                    className="px-4 py-2.5 text-right whitespace-nowrap text-muted-foreground"
                    title={t.lastAnalyze ?? undefined}
                  >
                    {t.kind === 'v' ? '—' : formatRelative(t.lastAnalyze)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && <p className="p-10 text-center text-sm text-muted-foreground">No tables match.</p>}
      </div>
    </div>
  );
}
