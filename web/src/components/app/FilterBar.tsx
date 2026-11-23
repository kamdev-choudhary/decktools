import { ListFilter, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { FILTER_OPS, type Column, type Filter } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface FilterBarProps {
  columns: Column[];
  value: Filter[];
  onApply: (filters: Filter[]) => void;
}

const needsValue = (f: Filter) => f.op !== 'is null' && f.op !== 'is not null';

export function FilterBar({ columns, value, onApply }: FilterBarProps) {
  const [draft, setDraft] = useState<Filter[]>(value);
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  const update = (i: number, patch: Partial<Filter>) => setDraft((d) => d.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  const add = () => setDraft((d) => [...d, { col: columns[0]?.name ?? '', op: '=', val: '' }]);
  const remove = (i: number) => {
    const next = draft.filter((_, k) => k !== i);
    setDraft(next);
    onApply(next);
  };

  return (
    <form
      className="flex min-w-0 flex-1 flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(draft);
      }}
    >
      {draft.map((f, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <span className="w-12 text-right text-xs text-muted-foreground">{i === 0 ? 'where' : 'and'}</span>
          <Select value={f.col} onValueChange={(col) => update(i, { col })}>
            <SelectTrigger size="sm" className="w-44 font-mono text-xs" aria-label="Column">
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
            <SelectTrigger size="sm" className="w-32 text-xs" aria-label="Operator">
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
          {needsValue(f) && (
            <Input
              value={f.val ?? ''}
              onChange={(e) => update(i, { val: e.target.value })}
              placeholder="value"
              aria-label="Value"
              className="h-8 min-w-40 flex-1 font-mono text-xs"
            />
          )}
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(i)} aria-label="Remove filter">
            <X />
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        {draft.length === 0 ? (
          <Button type="button" variant="outline" size="sm" onClick={add} disabled={!columns.length}>
            <ListFilter /> Filter
          </Button>
        ) : (
          <>
            <span className="w-12" />
            <Button type="button" variant="ghost" size="sm" onClick={add}>
              <Plus /> Add condition
            </Button>
            <Button type="submit" size="sm" disabled={!dirty}>
              Apply
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft([]);
                onApply([]);
              }}
            >
              Clear
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
