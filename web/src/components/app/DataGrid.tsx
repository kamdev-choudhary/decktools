import { ArrowDown, ArrowUp, ChevronsUpDown, KeyRound } from 'lucide-react';
import { useRef } from 'react';
import type { Cell, SortDir } from '@shared/types';
import { Checkbox } from '@/components/ui/checkbox';
import { isNumericType } from '@/lib/format';
import { cn } from '@/lib/utils';
import { FkHeaderLink, FkPeek, type FkTarget } from './ForeignKey';

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
  /** Wrap long values instead of truncating (Structure tab). */
  wrap?: boolean;
  className?: string;
  /** Database name, needed for foreign-key links. */
  db?: string;
  /** Single-column foreign keys by local column name. */
  foreignKeys?: Record<string, FkTarget>;
}

const edgeCell = 'sticky left-0 border-r border-b bg-grid-header px-3 text-right';

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
  className,
  db,
  foreignKeys,
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

  const selectedCount = selection?.selected.size ?? 0;
  const headerChecked = rows.length > 0 && selectedCount === rows.length ? true : selectedCount > 0 ? 'indeterminate' : false;

  return (
    <div className={cn('relative min-h-0 flex-1 overflow-auto', className)}>
      <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-20">
          <tr>
            <th className={cn(edgeCell, 'z-30 w-10 py-1.5 font-normal text-muted-foreground')}>
              {selection ? (
                <Checkbox
                  aria-label="Select all rows"
                  checked={headerChecked}
                  onCheckedChange={() => selection.onChange(headerChecked === true ? new Set() : new Set(rows.map((_, i) => i)))}
                />
              ) : (
                '#'
              )}
            </th>
            {fields.map((f) => {
              const sorted = sort?.col === f ? sort.dir : null;
              const SortIcon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ChevronsUpDown;
              return (
                <th
                  key={f}
                  className="border-r border-b bg-grid-header px-3 py-1.5 text-left align-top font-medium whitespace-nowrap"
                  aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                >
                  <button
                    type="button"
                    disabled={!onSort}
                    onClick={() => onSort?.(f)}
                    className="group/sort flex items-center gap-1.5 text-left disabled:cursor-default"
                  >
                    {pk.has(f) && <KeyRound className="size-3 text-warning" aria-label="Primary key" />}
                    <span>{f}</span>
                    {onSort && (
                      <SortIcon
                        className={cn(
                          'size-3.5 text-muted-foreground transition-opacity',
                          sorted ? 'text-foreground' : 'opacity-0 group-hover/sort:opacity-100',
                        )}
                      />
                    )}
                  </button>
                  {types?.[f] && <div className="font-mono text-[10.5px] font-normal text-muted-foreground">{types[f]}</div>}
                  {db && foreignKeys?.[f] && <FkHeaderLink db={db} fk={foreignKeys[f]} />}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isSelected = !!selection?.selected.has(i);
            return (
              <tr
                key={i}
                data-state={isSelected ? 'selected' : undefined}
                className={cn('group', onOpenRow && 'cursor-default')}
                onDoubleClick={
                  onOpenRow
                    ? (e) => {
                        const field = (e.target as HTMLElement).closest('td')?.dataset.field;
                        onOpenRow(i, field ?? fields[0] ?? '');
                      }
                    : undefined
                }
              >
                <td className={cn(edgeCell, 'z-10 py-2 align-middle text-xs text-muted-foreground tabular-nums')}>
                  {selection ? (
                    <Checkbox
                      aria-label={`Select row ${rowOffset + i + 1}`}
                      checked={isSelected}
                      onClick={(e) => {
                        e.preventDefault();
                        toggleRow(i, e.shiftKey);
                      }}
                    />
                  ) : (
                    rowOffset + i + 1
                  )}
                </td>
                {row.map((v, j) => (
                  <td
                    key={j}
                    data-field={fields[j]}
                    title={v && v.length > 40 ? v.slice(0, 4000) : undefined}
                    className={cn(
                      'border-r border-b px-3 py-2 align-top font-mono text-[12.5px] transition-colors group-hover:bg-row-hover group-data-[state=selected]:bg-row-selected',
                      wrap ? 'max-w-[640px] break-words whitespace-pre-wrap' : 'max-w-[360px] truncate',
                      numeric[j] && 'text-right tabular-nums',
                      v === null && 'text-null italic',
                    )}
                  >
                    {v === null ? (
                      'NULL'
                    ) : db && foreignKeys?.[fields[j]!] ? (
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="truncate">{v}</span>
                        <FkPeek db={db} fk={foreignKeys[fields[j]!]!} value={v} />
                      </span>
                    ) : wrap || v.length <= MAX_CELL_CHARS ? (
                      v
                    ) : (
                      `${v.slice(0, MAX_CELL_CHARS)}…`
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && <div className="p-10 text-center text-sm text-muted-foreground">{emptyText}</div>}
    </div>
  );
}
