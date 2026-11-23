import { Download, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Cell, Filter, RowKey, SortDir, TableMeta } from '@shared/types';
import { useRowMutations, useRows } from '@/api/hooks';
import { DataGrid } from '@/components/app/DataGrid';
import { ErrorAlert, errorMessage } from '@/components/app/feedback';
import { FilterBar } from '@/components/app/FilterBar';
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
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { downloadCsv } from '@/lib/format';
import { cn } from '@/lib/utils';

type EditorState = { mode: 'insert' } | { mode: 'edit'; index: number; focusField: string };

export function DataTab({ db, meta }: { db: string; meta: TableMeta }) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [sort, setSort] = useState<{ col: string; dir: SortDir } | null>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
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
  });
  const { insert, update, remove } = useRowMutations(db, meta.schema, meta.table);
  const data = rows.data;

  useEffect(() => setSelected(new Set()), [data]);

  const types = useMemo(() => Object.fromEntries(meta.columns.map((c) => [c.name, c.type])), [meta.columns]);

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
      <div className="flex flex-wrap items-start gap-3 border-b px-4 py-3 md:px-6">
        <FilterBar
          columns={meta.columns}
          value={filters}
          onApply={(f) => {
            setFilters(f);
            setPage(0);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          {meta.editable && selected.size > 0 && (
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Delete {selected.size}
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon-sm" onClick={() => rows.refetch()} disabled={rows.isFetching} aria-label="Refresh">
                <RefreshCw className={cn(rows.isFetching && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Export CSV"
                disabled={!data?.rows.length}
                onClick={() => data && downloadCsv(`${meta.schema}.${meta.table}.csv`, data.fields, data.rows)}
              >
                <Download />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Export this page as CSV</TooltipContent>
          </Tooltip>
          {meta.editable && (
            <Button size="sm" onClick={() => setEditor({ mode: 'insert' })}>
              <Plus /> Add row
            </Button>
          )}
        </div>
      </div>

      {rows.isError && <ErrorAlert error={rows.error} className="mx-4 mt-3 w-auto md:mx-6" />}

      <DataGrid
        fields={data?.fields ?? meta.columns.map((c) => c.name)}
        rows={data?.rows ?? []}
        types={types}
        primaryKey={meta.primaryKey}
        sort={sort}
        onSort={onSort}
        rowOffset={page * pageSize}
        selection={meta.editable ? { selected, onChange: setSelected } : undefined}
        onOpenRow={meta.editable ? (index, focusField) => setEditor({ mode: 'edit', index, focusField }) : undefined}
        emptyText={rows.isPending ? 'Loading…' : filters.length ? 'No rows match these filters.' : 'This table is empty.'}
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
