import { ArrowUpRight, Eye, Layers, Table2, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { REL_KIND_LABEL, type RelKind } from '@shared/types';
import { useInfo, useTables } from '@/api/hooks';
import { CenteredSpinner, ErrorAlert } from '@/components/app/feedback';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/format';
import { sqlHref, tableHref } from '@/lib/router';

const KIND_ICON: Record<RelKind, LucideIcon> = { r: Table2, p: Table2, f: Table2, v: Eye, m: Layers };

function Stat({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      {value === undefined ? <Skeleton className="mt-2 h-7 w-16" /> : <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>}
    </div>
  );
}

export function OverviewView({ db }: { db: string }) {
  const info = useInfo(db);
  const tables = useTables(db);
  const [filter, setFilter] = useState('');

  const list = tables.data;
  const counts = useMemo(() => {
    if (!list) return undefined;
    const views = list.filter((t) => t.kind === 'v' || t.kind === 'm').length;
    return { tables: list.length - views, views, schemas: new Set(list.map((t) => t.schema)).size };
  }, [list]);

  const shown = (list ?? []).filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">{db}</h1>
            <p className="text-sm text-muted-foreground">{info.data?.version ?? ' '}</p>
          </div>
          <a
            href={sqlHref(db)}
            className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Open SQL Editor <ArrowUpRight className="size-4" />
          </a>
        </div>

        {info.isError && <ErrorAlert error={info.error} />}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Tables" value={counts && formatNumber(counts.tables)} />
          <Stat label="Views" value={counts && formatNumber(counts.views)} />
          <Stat label="Schemas" value={counts && formatNumber(counts.schemas)} />
          <Stat label="Size on disk" value={info.data?.size} />
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-medium">Tables &amp; views</h2>
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" className="h-8 max-w-60" />
          </div>
          {tables.isPending ? (
            <CenteredSpinner />
          ) : tables.isError ? (
            <ErrorAlert error={tables.error} />
          ) : (
            <div className="divide-y overflow-hidden rounded-lg border">
              {shown.map((t) => {
                const Icon = KIND_ICON[t.kind];
                return (
                  <a
                    key={`${t.schema}.${t.name}`}
                    href={tableHref(db, t.schema, t.name)}
                    className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/50"
                  >
                    <Icon className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate font-medium">{t.name}</span>
                    {t.schema !== 'public' && (
                      <Badge variant="secondary" className="font-mono text-[11px]">
                        {t.schema}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">{REL_KIND_LABEL[t.kind]}</span>
                  </a>
                );
              })}
              {!shown.length && <p className="p-8 text-center text-sm text-muted-foreground">No tables to show.</p>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
