import { Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import type { Cell, RowKey, SortDir, TableMeta } from '@shared/types';
import { useRowMutations, useRows } from '@/api/hooks';
import { DataGrid } from '@/components/app/DataGrid';
import { ErrorAlert, errorMessage } from '@/components/app/feedback';
import { FilterControl, type FilterState } from '@/components/app/FilterBar';
import { singleColumnFks } from '@/components/app/ForeignKey';
import { ExportMenu } from '@/components/app/ExportMenu';
import { ImportDialog } from '@/components/app/ImportDialog';
import { BASE } from '@/api/client';
import { Pagination } from '@/components/app/Pagination';
import { RowEditor } from '@/components/app/RowEditor';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@deck/ui/components/alert-dialog';
import { Button } from '@deck/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@deck/ui/components/tooltip';
import { cn } from '@deck/ui/lib/utils';

type EditorState = { mode: 'insert' } | { mode: 'edit'; index: number; focusField: string };

interface DataTabProps {
  db: string;
  meta: TableMeta;
  /** Equality filters to start with (from an FK link). Unknown columns are ignored. */
  initialEq: Record<string, string>;
  actionsSlot: HTMLElement | null;
  /** pgdeck runs with --readonly (hides import). */
  readonly: boolean;
}

export function DataTab({ db, meta, initialEq, actionsSlot, readonly }: DataTabProps) {
  const [importing, setImporting] = useState(false);
  const canImport = !readonly && (meta.kind === 'r' || meta.kind === 'p');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [sort, setSort] = useState<{ col: string; dir: SortDir } | null>(null);
  const [filterState, setFilterState] = useState<FilterState>(() => ({
    filters: Object.entries(initialEq)
      .filter(([col]) => meta.columns.some((c) => c.name === col))
      .map(([col, val]) => ({ col, op: '=' as const, val })),
    match: 'and',
  }));
  const { filters, match } = filterState;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const rows = useRows(db, {
    schema: meta.schema,
    table: meta.table,
    limit: pageSize,
    offset: page * pageSize,
    sort: sort?.col,
    dir: sort?.dir,
    filters,
    match,
  });
  const { insert, update, remove } = useRowMutations(db, meta.schema, meta.table);
  const data = rows.data;

  // Clear the selection whenever a new set of rows arrives.
  const [selectionFor, setSelectionFor] = useState(data);
  if (selectionFor !== data) {
    setSelectionFor(data);
    setSelected(new Set());
  }

  const types = useMemo(() => Object.fromEntries(meta.columns.map((c) => [c.name, c.type])), [meta.columns]);
  const fks = useMemo(() => singleColumnFks(meta), [meta]);

  const rowObject = (i: number): Record<string, Cell> =>
    Object.fromEntries((data?.fields ?? []).map((f, j) => [f, data!.rows[i]![j] ?? null]));

  const keyOf = (i: number): RowKey => {
    if (meta.keyMode === 'ctid') return { ctid: data!.ctids![i]! };
    const row = rowObject(i);
    return Object.fromEntries(meta.primaryKey.map((col) => [col, row[col] ?? null]));
  };

  const onSort = (col: string) => {
    setPage(0);
    setSort((s) => (!s || s.col !== col ? { col, dir: 'asc' } : s.dir === 'asc' ? { col, dir: 'desc' } : null));
  };

  const deleteSelected = async () => {
    const indices = [...selected].sort((a, b) => a - b);
    try {
      const res = await remove.mutateAsync(indices.map(keyOf));
      toast.success(`Deleted ${res.rowCount} row${res.rowCount === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error('Delete failed', { description: errorMessage(e) });
    } finally {
      setConfirmDelete(false);
    }
  };

  const editIndex = editor?.mode === 'edit' ? editor.index : null;

  return (
    <>
      {actionsSlot &&
        createPortal(
          <>
            {meta.editable && selected.size > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 /> Delete {selected.size}
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => rows.refetch()}
                  disabled={rows.isFetching}
                  aria-label="Refresh"
                >
                  <RefreshCw className={cn(rows.isFetching && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
            {canImport && (
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => setImporting(true)}>
                <Upload /> <span className="hidden md:inline">Import</span>
              </Button>
            )}
            <ExportMenu
              baseName={meta.table}
              columns={meta.columns.map((c) => ({ name: c.name, typeName: c.typeName }))}
              target={{ schema: meta.schema, table: meta.table }}
              disabled={!data}
              scopes={[
                {
                  id: 'all',
                  label: filters.length ? 'All rows matching filters' : 'All rows',
                  count: data?.total,
                  approximate: data ? !data.totalExact : false,
                  url: (format) =>
                    `${BASE}api/db/${encodeURIComponent(db)}/export?${new URLSearchParams({
                      schema: meta.schema,
                      table: meta.table,
                      format,
                      filters: JSON.stringify(filters),
                      match,
                      ...(sort ? { sort: sort.col, dir: sort.dir } : {}),
                    })}`,
                },
                {
                  id: 'page',
                  label: 'This page',
                  count: data?.rows.length ?? 0,
                  rows: data?.rows ?? [],
                  disabled: !data?.rows.length,
                },
                {
                  id: 'selected',
                  label: 'Selected rows',
                  count: selected.size,
                  rows: [...selected].sort((a, b) => a - b).map((i) => data?.rows[i] ?? []),
                  disabled: !selected.size,
                },
              ]}
            />
            {meta.editable && (
              <Button size="sm" className="shrink-0" onClick={() => setEditor({ mode: 'insert' })}>
                <Plus /> <span className="hidden sm:inline">Add row</span>
              </Button>
            )}
          </>,
          actionsSlot,
        )}

      <FilterControl
        columns={meta.columns}
        value={filterState}
        onChange={(f) => {
          setFilterState(f);
          setPage(0);
        }}
      />

      {rows.isError && <ErrorAlert error={rows.error} className="mx-3 mt-2 w-auto md:mx-4" />}

      <DataGrid
        fields={data?.fields ?? meta.columns.map((c) => c.name)}
        rows={data?.rows ?? []}
        types={types}
        primaryKey={meta.primaryKey}
        db={db}
        foreignKeys={fks}
        sort={sort}
        onSort={onSort}
        rowOffset={page * pageSize}
        selection={meta.editable ? { selected, onChange: setSelected } : undefined}
        onOpenRow={meta.editable ? (index, focusField) => setEditor({ mode: 'edit', index, focusField }) : undefined}
        emptyText={
          rows.isPending ? 'Loading…' : filters.length ? 'No rows match these filters.' : 'This table is empty.'
        }
      />

      <Pagination
        page={page}
        pageSize={pageSize}
        shown={data?.rows.length ?? 0}
        total={data?.total ?? 0}
        exact={data?.totalExact ?? true}
        loading={rows.isFetching}
        onPage={setPage}
        onPageSize={(n) => {
          setPageSize(n);
          setPage(0);
        }}
      />

      {editor && (
        <RowEditor
          key={editor.mode === 'edit' ? `edit-${editor.index}` : 'insert'}
          meta={meta}
          db={db}
          foreignKeys={fks}
          mode={editor.mode}
          row={editIndex !== null ? rowObject(editIndex) : undefined}
          focusField={editor.mode === 'edit' ? editor.focusField : undefined}
          onClose={() => setEditor(null)}
          onSave={async (values) => {
            if (editIndex !== null) {
              await update.mutateAsync({ key: keyOf(editIndex), values });
              toast.success('Row updated');
            } else {
              await insert.mutateAsync(values);
              toast.success('Row inserted');
            }
          }}
        />
      )}

      {importing && <ImportDialog db={db} meta={meta} onClose={() => setImporting(false)} />}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selected.size} row{selected.size === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected rows from{' '}
              <span className="font-mono text-foreground">
                {meta.schema}.{meta.table}
              </span>
              . It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                void deleteSelected();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
