import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, KeyRound, Link2, Search, Table2 } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import type { Column, Filter, TableMeta } from '@shared/types';
import { api } from '@/api/client';
import { useMeta } from '@/api/hooks';
import { Button } from '@deck/ui/components/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@deck/ui/components/command';
import { Input } from '@deck/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@deck/ui/components/popover';
import { tableHref } from '@/lib/router';
import { cn } from '@deck/ui/lib/utils';
import { ErrorAlert, Spinner } from './feedback';
import { TruncatedText } from '@deck/ui/components/truncated-text';

/** Where a single-column foreign key points. */
export interface FkTarget {
  schema: string;
  table: string;
  column: string;
}

/** Single-column foreign keys of a table, keyed by the local column name. */
export function singleColumnFks(meta: TableMeta): Record<string, FkTarget> {
  const out: Record<string, FkTarget> = {};
  for (const fk of meta.foreignKeys) {
    if (fk.columns.length === 1 && fk.refColumns.length === 1) {
      out[fk.columns[0]!] = { schema: fk.refSchema, table: fk.refTable, column: fk.refColumns[0]! };
    }
  }
  return out;
}

const LABEL_NAMES = ['name', 'title', 'label', 'display_name', 'full_name', 'username', 'email', 'slug', 'code', 'description'];

/** A human-readable column of the referenced table to show next to keys. */
function labelColumn(meta: TableMeta | undefined, keyColumn: string): Column | undefined {
  if (!meta) return undefined;
  const others = meta.columns.filter((c) => c.name !== keyColumn);
  for (const n of LABEL_NAMES) {
    const hit = others.find((c) => c.name === n);
    if (hit) return hit;
  }
  return others.find((c) => c.category === 'S');
}

const shortTarget = (fk: FkTarget) => `${fk.schema === 'public' ? '' : `${fk.schema}.`}${fk.table}.${fk.column}`;

/* ------------------------------------------------------------------ */
/* Grid: header link and cell peek                                      */
/* ------------------------------------------------------------------ */

export function FkHeaderLink({ db, fk }: { db: string; fk: FkTarget }) {
  return (
    <a
      href={tableHref(db, fk.schema, fk.table)}
      onClick={(e) => e.stopPropagation()}
      className="mt-0.5 flex items-center gap-1 font-mono text-[10.5px] font-normal text-link hover:underline"
      title={`Foreign key → ${fk.schema}.${fk.table}(${fk.column})`}
    >
      <Link2 className="size-3" />
      {shortTarget(fk)}
    </a>
  );
}

function PeekBody({ db, fk, value }: { db: string; fk: FkTarget; value: string }) {
  const filters: Filter[] = [{ col: fk.column, op: '=', val: value }];
  const row = useQuery({
    queryKey: ['db', db, 'fk-peek', fk.schema, fk.table, fk.column, value],
    queryFn: () => api.rows(db, { schema: fk.schema, table: fk.table, limit: 1, offset: 0, filters }),
  });
  const meta = useMeta(db, fk.schema, fk.table);
  const types = new Map(meta.data?.columns.map((c) => [c.name, c.type]));
  const href = tableHref(db, fk.schema, fk.table, { [fk.column]: value });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header band, styled like the grid's column headers. */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-grid-header px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
            <Table2 className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {fk.schema === 'public' ? '' : `${fk.schema}.`}
              {fk.table}
            </div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              where {fk.column} = {value}
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={href}>
            Open <ArrowUpRight />
          </a>
        </Button>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {row.isPending && (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        )}
        {row.isError && <ErrorAlert error={row.error} className="m-4 w-auto" />}
        {row.isSuccess && !row.data.rows.length && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No matching row. The reference may be broken.</p>}
        {row.isSuccess && row.data.rows[0] && (
          <dl>
            {row.data.fields.map((f, i) => {
              const v = row.data.rows[0]![i] ?? null;
              const isKey = f === fk.column;
              return (
                <div
                  key={f}
                  className={cn(
                    'grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-start gap-4 border-b px-4 py-2 last:border-b-0 hover:bg-row-hover',
                    isKey && 'bg-row-selected hover:bg-row-selected',
                  )}
                >
                  <dt className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[13px] font-medium" title={f}>
                      {isKey && <KeyRound className="size-3 shrink-0 text-warning" aria-label="Referenced key" />}
                      <span className="truncate">{f}</span>
                    </div>
                    {types.get(f) && <div className="truncate font-mono text-[10.5px] text-muted-foreground">{types.get(f)}</div>}
                  </dt>
                  <dd className={cn('min-w-0 pt-px font-mono text-[12.5px]', v === null && 'text-null italic')}>
                    <TruncatedText text={v ?? 'NULL'} side="left" />
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>
    </div>
  );
}

/** An FK cell's value, drawn as a link; clicking it previews the referenced row. */
export function FkPeek({ db, fk, value }: { db: string; fk: FkTarget; value: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* The value itself is the link to the referenced row. */}
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          title={`Show the referenced ${fk.table} row`}
          className="inline-block max-w-full cursor-pointer truncate rounded-sm align-top text-link underline decoration-link/40 underline-offset-[3px] transition-colors hover:decoration-link focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none data-[state=open]:decoration-link"
        >
          {value}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-[min(32rem,var(--radix-popover-content-available-height))] w-[min(34rem,calc(100vw-2rem))] flex-col overflow-hidden p-0"
      >
        {open && <PeekBody db={db} fk={fk} value={value} />}
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Row editor: searchable picker                                        */
/* ------------------------------------------------------------------ */

function PickerOptions({ db, fk, current, onPick }: { db: string; fk: FkTarget; current: string; onPick: (v: string) => void }) {
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const meta = useMeta(db, fk.schema, fk.table);
  const label = labelColumn(meta.data, fk.column);

  const filters: Filter[] = term
    ? [{ col: fk.column, op: 'contains', val: term }, ...(label ? [{ col: label.name, op: 'contains' as const, val: term }] : [])]
    : [];
  const rows = useQuery({
    queryKey: ['db', db, 'fk-options', fk.schema, fk.table, fk.column, label?.name ?? '', term],
    queryFn: () =>
      api.rows(db, { schema: fk.schema, table: fk.table, limit: 50, offset: 0, filters, match: 'or', sort: label?.name }),
    enabled: meta.isSuccess || meta.isError,
  });

  const keyIdx = rows.data?.fields.indexOf(fk.column) ?? -1;
  const labelIdx = label ? (rows.data?.fields.indexOf(label.name) ?? -1) : -1;

  return (
    <Command shouldFilter={false}>
      <CommandInput value={search} onValueChange={setSearch} placeholder={`Search ${fk.table}${label ? ` by ${fk.column} or ${label.name}` : ''}…`} />
      <CommandList className="max-h-72">
        {(rows.isPending || meta.isPending) && (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        )}
        {rows.isError && <ErrorAlert error={rows.error} className="m-2 w-auto" />}
        {rows.isSuccess && <CommandEmpty>No rows match.</CommandEmpty>}
        {rows.isSuccess && rows.data.rows.length > 0 && (
          <CommandGroup heading={`${fk.schema}.${fk.table}${rows.data.total > rows.data.rows.length ? ` · first ${rows.data.rows.length} of ${rows.data.total}` : ''}`}>
            {rows.data.rows.map((r, i) => {
              const key = r[keyIdx] ?? '';
              const text = labelIdx >= 0 ? r[labelIdx] : null;
              return (
                <CommandItem key={`${key}-${i}`} value={key} onSelect={() => onPick(key)} className="flex items-center gap-3">
                  <span className={cn('size-1.5 shrink-0 rounded-full', key === current ? 'bg-primary' : 'bg-transparent')} />
                  <span className="min-w-0 flex-1 truncate">{text ?? <span className="text-muted-foreground">—</span>}</span>
                  <span className="max-w-[55%] shrink-0 truncate font-mono text-[11px] text-muted-foreground">{key}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

interface FkFieldProps {
  id: string;
  column: Column;
  db: string;
  fk: FkTarget;
  value: string;
  disabled: boolean;
  placeholder: string;
  className?: string;
  onChange: (v: string) => void;
}

/** FK column editor: free text plus a "Browse" picker over the referenced table. */
export function FkField({ id, column, db, fk, value, disabled, placeholder, className, onChange }: FkFieldProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input
          id={id}
          data-field={column.name}
          value={value}
          disabled={disabled}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn('font-mono text-[13px]', className)}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" disabled={disabled}>
              <Search /> Browse
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-[min(30rem,calc(100vw-2rem))] flex-col overflow-hidden p-0">
            {open && (
              <PickerOptions
                db={db}
                fk={fk}
                current={value}
                onPick={(v) => {
                  onChange(v);
                  setOpen(false);
                }}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>
      <p className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
        <Link2 className="size-3" /> references {fk.schema}.{fk.table}({fk.column})
      </p>
    </div>
  );
}
