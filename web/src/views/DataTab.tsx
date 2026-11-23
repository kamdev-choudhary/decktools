import { useEffect, useMemo, useState } from 'react';
import type { Cell, Filter, RowKey, SortDir, TableMeta } from '@shared/types';
import { useRowMutations, useRows } from '../api/hooks';
import { DataGrid } from '../components/DataGrid';
import { ErrorBox, errorMessage } from '../components/ErrorBox';
import { FilterBar } from '../components/FilterBar';
import { Pagination } from '../components/Pagination';
import { RowEditor } from '../components/RowEditor';
import { useToast } from '../components/Toast';
import { downloadCsv } from '../lib/format';

type EditorState = { mode: 'insert' } | { mode: 'edit'; index: number; focusField: string };

export function DataTab({ meta }: { meta: TableMeta }) {
  const toast = useToast();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [sort, setSort] = useState<{ col: string; dir: SortDir } | null>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editor, setEditor] = useState<EditorState | null>(null);

  const rows = useRows({
    schema: meta.schema,
    table: meta.table,
    limit: pageSize,
    offset: page * pageSize,
    sort: sort?.col,
    dir: sort?.dir,
    filters,
  });
  const { insert, update, remove } = useRowMutations(meta.schema, meta.table);
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

  const onDelete = async () => {
    const indices = [...selected].sort((a, b) => a - b);
    if (!indices.length) return;
    const ok = window.confirm(`Delete ${indices.length} row(s) from ${meta.schema}.${meta.table}? This cannot be undone.`);
    if (!ok) return;
    try {
      const res = await remove.mutateAsync(indices.map(keyOf));
      toast(`Deleted ${res.rowCount} row(s)`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const editIndex = editor?.mode === 'edit' ? editor.index : null;

  return (
    <>
      <div className="toolbar">
        <FilterBar
          columns={meta.columns}
          value={filters}
          onApply={(f) => {
            setFilters(f);
            setPage(0);
          }}
        />
        <div className="actions">
          <button className="btn" onClick={() => rows.refetch()} disabled={rows.isFetching}>
            ↻ Refresh
          </button>
          {meta.editable && (
            <>
              <button className="btn primary" onClick={() => setEditor({ mode: 'insert' })}>
                + Add row
              </button>
              <button className="btn danger" onClick={onDelete} disabled={!selected.size || remove.isPending}>
                Delete{selected.size ? ` (${selected.size})` : ''}
              </button>
            </>
          )}
          <button
            className="btn"
            disabled={!data?.rows.length}
            onClick={() => data && downloadCsv(`${meta.schema}.${meta.table}.csv`, data.fields, data.rows)}
          >
            Export CSV
          </button>
        </div>
      </div>

      {rows.isError && <ErrorBox error={rows.error} />}

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
        emptyText={rows.isPending ? 'Loading…' : filters.length ? 'No rows match these filters' : 'This table is empty'}
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
              toast('Row updated');
            } else {
              await insert.mutateAsync(values);
              toast('Row inserted');
            }
          }}
        />
      )}
    </>
  );
}
