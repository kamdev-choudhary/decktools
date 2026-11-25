import { ListFilter, Plus, X } from 'lucide-react';
import { useState } from 'react';
import {
  FILTER_OPS,
  LIST_OPS,
  UNARY_OPS,
  type Column,
  type Filter,
  type FilterMatch,
  type FilterOp,
} from '@shared/types';
import { Badge } from '@deck/ui/components/badge';
import { Button } from '@deck/ui/components/button';
import { Input } from '@deck/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@deck/ui/components/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@deck/ui/components/select';
import { cn } from '@deck/ui/lib/utils';
import { Combobox } from '@deck/ui/components/combobox';
import { fieldKind } from './FieldInput';

const needsValue = (f: Filter) => !UNARY_OPS.includes(f.op);
const isList = (op: FilterOp) => LIST_OPS.includes(op);

/** Operators grouped for the dropdown, so the long list stays scannable. */
const OP_GROUPS: FilterOp[][] = [
  ['=', '!=', '<', '<=', '>', '>='],
  ['contains', 'not contains', 'starts with', 'ends with'],
  ['in', 'not in'],
  ['like', 'ilike'],
  ['is null', 'is not null'],
];
// Keep the grouping honest if FILTER_OPS gains an entry.
if (OP_GROUPS.flat().length !== FILTER_OPS.length) console.warn('pgdeck: OP_GROUPS out of sync with FILTER_OPS');

const OP_LABEL: Partial<Record<FilterOp, string>> = { '!=': '≠', '<=': '≤', '>=': '≥' };

export interface FilterState {
  filters: Filter[];
  match: FilterMatch;
}

/** Value editor that fits the column type and operator. */
function ValueInput({
  column,
  filter,
  onChange,
  autoFocus,
}: {
  column?: Column;
  filter: Filter;
  onChange: (val: string) => void;
  autoFocus: boolean;
}) {
  const kind = column ? fieldKind(column) : 'text';
  const value = filter.val ?? '';
  const cls = 'h-8 min-w-0 flex-1 font-mono text-xs';

  if (!isList(filter.op) && kind === 'enum' && column?.enumValues) {
    return (
      <Combobox
        value={value || undefined}
        onChange={onChange}
        options={column.enumValues.map((v) => ({ value: v }))}
        placeholder="Choose…"
        searchPlaceholder="Search values…"
        mono
        aria-label="Value"
        className="min-w-0 flex-1"
      />
    );
  }
  if (!isList(filter.op) && kind === 'boolean') {
    return (
      <div className="inline-flex h-8 flex-1 rounded-md border p-0.5" role="radiogroup" aria-label="Value">
        {(['t', 'f'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn(
              'flex-1 rounded-[5px] font-mono text-xs text-muted-foreground hover:text-foreground',
              value === v && 'bg-primary text-primary-foreground hover:text-primary-foreground',
            )}
          >
            {v === 't' ? 'true' : 'false'}
          </button>
        ))}
      </div>
    );
  }
  if (!isList(filter.op) && kind === 'date' && ['=', '!=', '<', '<=', '>', '>='].includes(filter.op)) {
    return (
      <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={cls} aria-label="Value" />
    );
  }

  const placeholder = isList(filter.op)
    ? 'a, b, c'
    : filter.op === 'like' || filter.op === 'ilike'
      ? '%pattern%'
      : kind === 'number'
        ? '0'
        : kind === 'datetime'
          ? 'YYYY-MM-DD HH:MM'
          : 'value';
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={kind === 'number' && !isList(filter.op) ? 'decimal' : undefined}
      aria-label="Value"
      autoFocus={autoFocus}
      className={cls}
    />
  );
}

/** The condition builder shown inside the filter popover. */
function FilterEditor({
  columns,
  value,
  onApply,
}: {
  columns: Column[];
  value: FilterState;
  onApply: (next: FilterState) => void;
}) {
  const blank = (): Filter => ({ col: columns[0]?.name ?? '', op: '=', val: '' });
  const [draft, setDraft] = useState<Filter[]>(value.filters.length ? value.filters : [blank()]);
  const [match, setMatch] = useState<FilterMatch>(value.match);
  const byName = new Map(columns.map((c) => [c.name, c]));

  const update = (i: number, patch: Partial<Filter>) =>
    setDraft((d) => d.map((f, k) => (k === i ? { ...f, ...patch } : f)));

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        onApply({ filters: draft.filter((f) => f.col), match });
      }}
    >
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {draft.map((f, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-16 shrink-0 text-right text-xs text-muted-foreground">
              {i === 0 ? (
                'Where'
              ) : i === 1 ? (
                <Select value={match} onValueChange={(m) => setMatch(m as FilterMatch)}>
                  <SelectTrigger size="sm" className="h-8 w-16 px-2 text-xs" aria-label="Combine conditions with">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="and" className="text-xs">
                      and
                    </SelectItem>
                    <SelectItem value="or" className="text-xs">
                      or
                    </SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <span className="pr-2">{match}</span>
              )}
            </div>
            <Combobox
              value={f.col}
              onChange={(col) => update(i, { col, val: '' })}
              options={columns.map((c) => ({ value: c.name, hint: c.typeName }))}
              searchPlaceholder="Search columns…"
              mono
              aria-label="Column"
              className="w-44"
            />
            <Select value={f.op} onValueChange={(op) => update(i, { op: op as FilterOp })}>
              <SelectTrigger size="sm" className="h-8 w-32 shrink-0 text-xs" aria-label="Operator">
                <SelectValue>{OP_LABEL[f.op] ?? f.op}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {OP_GROUPS.map((group, gi) => (
                  <div key={gi}>
                    {gi > 0 && <SelectSeparator />}
                    {group.map((op) => (
                      <SelectItem key={op} value={op} className="text-xs">
                        {OP_LABEL[op] ?? op}
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
            {needsValue(f) ? (
              <ValueInput
                column={byName.get(f.col)}
                filter={f}
                onChange={(val) => update(i, { val })}
                autoFocus={i === draft.length - 1}
              />
            ) : (
              <span className="flex-1" />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              onClick={() => setDraft((d) => d.filter((_, k) => k !== i))}
              aria-label="Remove condition"
            >
              <X />
            </Button>
          </div>
        ))}
        {!draft.length && (
          <p className="py-4 text-center text-xs text-muted-foreground">No conditions. Add one below.</p>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t p-3">
        <Button type="button" variant="outline" size="sm" onClick={() => setDraft((d) => [...d, blank()])}>
          <Plus /> Add condition
        </Button>
        <div className="flex gap-2">
          {value.filters.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onApply({ filters: [], match: 'and' })}>
              Clear all
            </Button>
          )}
          <Button type="submit" size="sm">
            Apply
          </Button>
        </div>
      </div>
    </form>
  );
}

interface FilterControlProps {
  columns: Column[];
  value: FilterState;
  onChange: (next: FilterState) => void;
}

/**
 * The dedicated filter row above the grid: a label, one chip per active
 * condition (click to edit, × to remove) joined by and/or, "Add filter",
 * and "Clear all".
 */
export function FilterControl({ columns, value, onChange }: FilterControlProps) {
  const [open, setOpen] = useState(false);
  const { filters, match } = value;

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-grid-header/60 px-3 md:px-4">
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <ListFilter className="size-3.5" />
        <span className="hidden sm:inline">Filters</span>
        {filters.length > 0 && (
          <Badge className="h-4 min-w-4 rounded-full px-1 text-[10px] tabular-nums">{filters.length}</Badge>
        )}
      </span>

      <Popover open={open} onOpenChange={setOpen}>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {filters.map((f, i) => (
            <div key={i} className="flex shrink-0 items-center gap-1.5">
              {i > 0 && <span className="text-[11px] font-medium text-muted-foreground uppercase">{match}</span>}
              <span className="inline-flex h-8 max-w-72 items-center rounded-md border bg-background font-mono text-xs">
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  className="flex min-w-0 items-center gap-1 py-0.5 pr-1 pl-2 hover:text-foreground"
                  title={`Edit: ${f.col} ${f.op}${needsValue(f) ? ` ${f.val ?? ''}` : ''}`}
                >
                  <span className="truncate">{f.col}</span>
                  <span className="shrink-0 text-muted-foreground">{OP_LABEL[f.op] ?? f.op}</span>
                  {needsValue(f) && (
                    <span className="truncate text-link">
                      {f.val === 't' ? 'true' : f.val === 'f' ? 'false' : f.val || "''"}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="mr-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => onChange({ filters: filters.filter((_, k) => k !== i), match })}
                  aria-label={`Remove filter on ${f.col}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            </div>
          ))}
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0" disabled={!columns.length}>
              <Plus /> {filters.length ? 'Add' : 'Add filter'}
            </Button>
          </PopoverTrigger>
        </div>
        <PopoverContent align="start" className="flex w-[min(42rem,calc(100vw-2rem))] flex-col overflow-hidden p-0">
          <FilterEditor
            columns={columns}
            value={value}
            onApply={(next) => {
              onChange(next);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>

      {filters.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground"
          onClick={() => onChange({ filters: [], match: 'and' })}
        >
          Clear all
        </Button>
      )}
    </div>
  );
}
