import { useRef } from 'react';
import type { Cell, SortDir } from '@shared/types';
import { isNumericType } from '../lib/format';

const MAX_CELL_CHARS = 300;

export interface DataGridProps {
  fields: string[];
  rows: Cell[][];
  /** Column name → Postgres type, shown under headers and used for alignment. */
  types?: Record<string, string>;
  primaryKey?: string[];
  sort?: { col: string; dir: SortDir } | null;
  onSort?: (col: string) => void;
  /** Enables the checkbox column. */
  selection?: { selected: Set<number>; onChange: (next: Set<number>) => void };
  onOpenRow?: (index: number, field: string) => void;
  /** Row number of the first row, for the # column. */
  rowOffset?: number;
  emptyText?: string;
  /** Wrap long values instead of truncating (used by the Structure tab). */
  wrap?: boolean;
}

export function DataGrid({
  fields,
  rows,
  types,
  primaryKey = [],
  sort,
  onSort,
  selection,
  onOpenRow,
  rowOffset = 0,
  emptyText = 'No rows',
  wrap = false,
}: DataGridProps) {
  const lastClicked = useRef<number | null>(null);
  const pk = new Set(primaryKey);
  const numeric = fields.map((f) => isNumericType(types?.[f]));

  const toggleRow = (i: number, shift: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    const turnOn = !next.has(i);
    const anchor = shift && lastClicked.current !== null ? lastClicked.current : i;
    for (let k = Math.min(anchor, i); k <= Math.max(anchor, i); k++) {
      if (turnOn) next.add(k);
      else next.delete(k);
    }
    lastClicked.current = i;
    selection.onChange(next);
  };

  const allSelected = !!selection && rows.length > 0 && selection.selected.size === rows.length;

  return (
    <div className="grid-wrap">
      <table className={`grid ${wrap ? 'wrap' : ''}`}>
        <thead>
          <tr>
            {selection ? (
              <th className="chk">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  onChange={() => selection.onChange(allSelected ? new Set() : new Set(rows.map((_, i) => i)))}
                />
              </th>
            ) : (
              <th className="rownum">#</th>
            )}
            {fields.map((f) => (
              <th
                key={f}
                className={onSort ? 'sortable' : undefined}
                onClick={onSort ? () => onSort(f) : undefined}
                aria-sort={sort?.col === f ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {f}
                {pk.has(f) && (
                  <span className="pk" title="Primary key">
                    PK
                  </span>
                )}
                {sort?.col === f && <span className="arrow">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
                {types?.[f] && <span className="t">{types[f]}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={selection?.selected.has(i) ? 'sel' : undefined}
              onDoubleClick={
                onOpenRow
                  ? (e) => {
                      const field = (e.target as HTMLElement).closest('td')?.dataset.field;
                      onOpenRow(i, field ?? fields[0] ?? '');
                    }
                  : undefined
              }
            >
              {selection ? (
                <td className="chk">
                  <input
                    type="checkbox"
                    aria-label={`Select row ${rowOffset + i + 1}`}
                    checked={selection.selected.has(i)}
                    onClick={(e) => toggleRow(i, e.shiftKey)}
                    readOnly
                  />
                </td>
              ) : (
                <td className="rownum">{rowOffset + i + 1}</td>
              )}
              {row.map((v, j) =>
                v === null ? (
                  <td key={j} className="null" data-field={fields[j]}>
                    NULL
                  </td>
                ) : (
                  <td
                    key={j}
                    className={numeric[j] ? 'num' : undefined}
                    data-field={fields[j]}
                    title={v.length > 40 ? v.slice(0, 4000) : undefined}
                  >
                    {wrap || v.length <= MAX_CELL_CHARS ? v : `${v.slice(0, MAX_CELL_CHARS)}…`}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <div className="grid-empty">{emptyText}</div>}
    </div>
  );
}
