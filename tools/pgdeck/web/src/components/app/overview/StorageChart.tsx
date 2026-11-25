import type { TableStats } from '@shared/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@deck/ui/components/tooltip';
import { formatBytes, formatNumber } from '@/lib/format';
import { tableHref } from '@/lib/router';

const TOP_N = 10;

interface Bar {
  key: string;
  label: string;
  href?: string;
  data: number;
  index: number;
  rows?: number;
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-2.5 rounded-[3px] ${className}`} />
      {label}
    </span>
  );
}

/**
 * Horizontal stacked bars: where disk space goes, split into table data and
 * indexes. Top N relations by total size, the remainder folded into "Other".
 */
export function StorageChart({ db, tables }: { db: string; tables: TableStats[] }) {
  const sized = tables.filter((t) => t.totalBytes > 0).sort((a, b) => b.totalBytes - a.totalBytes);
  const bars: Bar[] = sized.slice(0, TOP_N).map((t) => ({
    key: `${t.schema}.${t.name}`,
    label: t.schema === 'public' ? t.name : `${t.schema}.${t.name}`,
    href: tableHref(db, t.schema, t.name),
    data: t.tableBytes,
    index: t.indexBytes,
    rows: t.rows,
  }));
  // The long tail is summarised in text: as a bar it would dwarf the top N.
  const rest = sized.slice(TOP_N);
  const restBytes = rest.reduce((sum, t) => sum + t.totalBytes, 0);

  const max = Math.max(...bars.map((b) => b.data + b.index), 1);

  if (!bars.length) return <p className="py-8 text-center text-sm text-muted-foreground">No table storage yet.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <LegendSwatch className="bg-chart-data" label="Table data" />
        <LegendSwatch className="bg-chart-index" label="Indexes" />
      </div>
      <ul className="space-y-1">
        {bars.map((b) => {
          const total = b.data + b.index;
          const row = (
            <div className="group flex h-7 items-center gap-3 rounded-md px-1 text-[13px] hover:bg-muted/50">
              <span className="w-36 shrink-0 truncate text-muted-foreground group-hover:text-foreground sm:w-44" title={b.label}>
                {b.label}
              </span>
              <div className="flex h-3.5 min-w-0 flex-1 gap-[2px]">
                {b.data > 0 && (
                  <div
                    className="bg-chart-data min-w-[2px] rounded-l-[2px] rounded-r-[4px] data-[last=false]:rounded-r-[2px]"
                    data-last={b.index === 0}
                    style={{ width: `${(b.data / max) * 100}%` }}
                  />
                )}
                {b.index > 0 && (
                  <div className="bg-chart-index min-w-[2px] rounded-l-[2px] rounded-r-[4px]" style={{ width: `${(b.index / max) * 100}%` }} />
                )}
              </div>
              <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{formatBytes(total)}</span>
            </div>
          );
          return (
            <li key={b.key}>
              <Tooltip>
                <TooltipTrigger asChild>{b.href ? <a href={b.href}>{row}</a> : <div>{row}</div>}</TooltipTrigger>
                <TooltipContent side="top" align="start" className="space-y-1 text-xs">
                  <div className="font-medium">{b.label}</div>
                  <div className="flex items-center gap-2">
                    <span className="bg-chart-data size-2 rounded-[2px]" /> Table data <span className="ml-auto pl-4 tabular-nums">{formatBytes(b.data)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="bg-chart-index size-2 rounded-[2px]" /> Indexes <span className="ml-auto pl-4 tabular-nums">{formatBytes(b.index)}</span>
                  </div>
                  {b.rows !== undefined && <div className="text-background/70">{formatNumber(b.rows)} rows</div>}
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
      {rest.length > 0 && (
        <p className="border-t pt-3 text-xs text-muted-foreground">
          +{rest.length} more relation{rest.length > 1 ? 's' : ''} totalling{' '}
          <span className="text-foreground tabular-nums">{formatBytes(restBytes)}</span>. See the full list below.
        </p>
      )}
    </div>
  );
}
