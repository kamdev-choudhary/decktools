import { ListFilter, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { FILTER_OPS, type Column, type Filter } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const needsValue = (f: Filter) => f.op !== 'is null' && f.op !== 'is not null';

interface FilterEditorProps {
  columns: Column[];
  value: Filter[];
  onApply: (filters: Filter[]) => void;
}

/** The condition builder shown inside the filter popover. */
function FilterEditor({ columns, value, onApply }: FilterEditorProps) {
  const blank = (): Filter => ({ col: columns[0]?.name ?? '', op: '=', val: '' });
  const [draft, setDraft] = useState<Filter[]>(value.length ? value : [blank()]);

  const update = (i: number, patch: Partial<Filter>) => setDraft((d) => d.map((f, k) => (k === i ? { ...f, ...patch } : f)));

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(draft.filter((f) => f.col));
      }}
    >
      <div className="space-y-2">
        {draft.map((f, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">{i === 0 ? 'where' : 'and'}</span>
            <Select value={f.col} onValueChange={(col) => update(i, { col })}>
              <SelectTrigger size="sm" className="w-40 min-w-0 font-mono text-xs" aria-label="Column">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {columns.map((c) => (
                  <SelectItem key={c.name} value={c.name} className="font-mono text-xs">
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={f.op} onValueChange={(op) => update(i, { op: op as Filter['op'] })}>
              <SelectTrigger size="sm" className="w-28 shrink-0 text-xs" aria-label="Operator">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTER_OPS.map((op) => (
                  <SelectItem key={op} value={op} className="text-xs">
                    {op}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {needsValue(f) ? (
              <Input
                value={f.val ?? ''}
                onChange={(e) => update(i, { val: e.target.value })}
                placeholder="value"
                aria-label="Value"
                autoFocus={i === draft.length - 1}
                className="h-8 min-w-0 flex-1 font-mono text-xs"
              />
            ) : (
              <span className="flex-1" />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setDraft((d) => d.filter((_, k) => k !== i))}
              aria-label="Remove condition"
            >
              <X />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => setDraft((d) => [...d, blank()])}>
          <Plus /> Add condition
        </Button>
        <div className="flex gap-2">
          {value.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onApply([])}>
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
  value: Filter[];
  onChange: (filters: Filter[]) => void;
}

/**
 * The dedicated filter row above the grid: a label, one chip per active
 * condition (click to edit, × to remove), "Add filter", and "Clear all".
 */
export function FilterControl({ columns, value, onChange }: FilterControlProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-grid-header/60 px-3 md:px-4">
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <ListFilter className="size-3.5" />
        <span className="hidden sm:inline">Filters</span>
        {value.length > 0 && <Badge className="h-4 min-w-4 rounded-full px-1 text-[10px] tabular-nums">{value.length}</Badge>}
      </span>

      <Popover open={open} onOpenChange={setOpen}>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {value.map((f, i) => (
            <span
              key={i}
              className="inline-flex h-8 max-w-72 shrink-0 items-center rounded-md border bg-background font-mono text-xs"
            >
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex min-w-0 items-center gap-1 py-0.5 pr-1 pl-2 hover:text-foreground"
                title={`Edit: ${f.col} ${f.op}${needsValue(f) ? ` ${f.val ?? ''}` : ''}`}
              >
                <span className="truncate">{f.col}</span>
                <span className="shrink-0 text-muted-foreground">{f.op}</span>
                {needsValue(f) && <span className="truncate text-link">{f.val || "''"}</span>}
              </button>
              <button
                type="button"
                className="mr-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => onChange(value.filter((_, k) => k !== i))}
                aria-label={`Remove filter on ${f.col}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0" disabled={!columns.length}>
              <Plus /> {value.length ? 'Add' : 'Add filter'}
            </Button>
          </PopoverTrigger>
        </div>
        <PopoverContent align="start" className="w-[min(36rem,calc(100vw-2rem))] p-3">
          <FilterEditor
            columns={columns}
            value={value}
            onApply={(f) => {
              onChange(f);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={() => onChange([])}>
          Clear all
        </Button>
      )}
    </div>
  );
}
