import { useState } from 'react';
import { FILTER_OPS, type Column, type Filter } from '@shared/types';

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
      className="filters"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(draft);
      }}
    >
      {draft.map((f, i) => (
        <div className="filter-row" key={i}>
          <select className="input" value={f.col} onChange={(e) => update(i, { col: e.target.value })} aria-label="Column">
            {columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <select className="input" value={f.op} onChange={(e) => update(i, { op: e.target.value as Filter['op'] })} aria-label="Operator">
            {FILTER_OPS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
          {needsValue(f) && (
            <input
              className="input val"
              value={f.val ?? ''}
              placeholder="value"
              onChange={(e) => update(i, { val: e.target.value })}
              aria-label="Value"
            />
          )}
          <button type="button" className="btn ghost" onClick={() => remove(i)} aria-label="Remove filter">
            ✕
          </button>
        </div>
      ))}
      <div className="filter-row">
        <button type="button" className="btn" onClick={add} disabled={!columns.length}>
          + Filter
        </button>
        {draft.length > 0 && (
          <>
            <button type="submit" className="btn primary" disabled={!dirty}>
              Apply
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setDraft([]);
                onApply([]);
              }}
            >
              Clear
            </button>
          </>
        )}
      </div>
    </form>
  );
}
