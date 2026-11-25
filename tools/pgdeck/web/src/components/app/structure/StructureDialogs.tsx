import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { alterSql, INDEX_METHODS, validateAlter, type AlterAction, type IndexMethod } from '@shared/alter';
import { emptyColumn, isIntegerType, type NewColumn } from '@shared/create-table';
import type { Column, TableMeta } from '@shared/types';
import { api } from '@/api/client';
import { keys } from '@/api/hooks';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@deck/ui/components/alert-dialog';
import { Button } from '@deck/ui/components/button';
import { Checkbox } from '@deck/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@deck/ui/components/dialog';
import { Input } from '@deck/ui/components/input';
import { Label } from '@deck/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deck/ui/components/select';
import { cn } from '@deck/ui/lib/utils';
import { Combobox, type ComboOption } from '@deck/ui/components/combobox';
import { COMMON_TYPES, defaultSuggestions, Flag, ReferencePicker } from '../CreateTableDialog';
import { errorMessage, Spinner } from '../feedback';

/** Run one ALTER and refresh everything cached for the table. */
export function useAlter(db: string, schema: string, table: string, onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (change: AlterAction) => api.alter(db, schema, table, change),
    onSuccess: (res) => {
      toast.success(res.message);
      void qc.invalidateQueries({ queryKey: keys.db(db) });
      onDone?.();
    },
  });
}

export function SqlPreview({ statements }: { statements: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} />
        SQL preview
      </button>
      {open && (
        <pre className="max-h-56 overflow-auto border-t bg-muted/30 px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {statements.join('\n') || '-- no changes'}
        </pre>
      )}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function useTypeOptions(db: string): ComboOption[] {
  const catalog = useQuery({ queryKey: [...keys.db(db), 'catalog'], queryFn: () => api.catalog(db) });
  return useMemo(
    () => [...COMMON_TYPES, ...(catalog.data?.types ?? []).map((t) => ({ value: t.name, hint: t.kind }))],
    [catalog.data],
  );
}

export function DialogShell({
  title,
  description,
  statements,
  errors,
  error,
  pending,
  confirm,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  description: React.ReactNode;
  statements: string[];
  errors: string[];
  error: unknown;
  pending: boolean;
  confirm: string;
  onClose: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  const [touched, setTouched] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!errors.length && statements.length) onSubmit();
          }}
        >
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="[overflow-wrap:anywhere]">{description}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            {children}
            <SqlPreview statements={statements} />
          </div>
          <DialogFooter className="items-center border-t px-6 py-4 sm:justify-between">
            <div className="min-w-0 flex-1 text-xs">
              {error ? (
                <p className="max-h-20 overflow-auto font-mono whitespace-pre-wrap text-destructive">
                  {errorMessage(error)}
                </p>
              ) : touched && errors.length ? (
                <p className="text-destructive">{errors[0]}</p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !statements.length || (touched && errors.length > 0)}>
                {pending && <Spinner className="text-current" />}
                {confirm}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Add a column, or edit an existing one (name, type, default, not null, comment). */
export function ColumnDialog({
  db,
  meta,
  column,
  onClose,
}: {
  db: string;
  meta: TableMeta;
  column?: Column;
  onClose: () => void;
}) {
  const typeOptions = useTypeOptions(db);
  const alter = useAlter(db, meta.schema, meta.table, onClose);
  const editing = !!column;
  const [c, setC] = useState<NewColumn>(() =>
    column
      ? emptyColumn({
          name: column.name,
          type: column.type,
          nullable: column.nullable,
          default: column.default ?? '',
          comment: column.comment ?? '',
        })
      : emptyColumn({ name: '', type: 'text' }),
  );
  const [using, setUsing] = useState('');
  const set = (patch: Partial<NewColumn>) =>
    setC((prev) => {
      const next = { ...prev, ...patch };
      if (patch.primaryKey) next.nullable = false;
      if (patch.identity) next.default = '';
      if (patch.type !== undefined && !isIntegerType(patch.type)) next.identity = false;
      return next;
    });

  const change: AlterAction = useMemo(() => {
    if (!column) return { action: 'addColumn', column: { ...c, name: c.name.trim() } };
    const a: Extract<AlterAction, { action: 'alterColumn' }> = { action: 'alterColumn', column: column.name };
    if (c.name.trim() !== column.name) a.newName = c.name.trim();
    if (c.type.trim() !== column.type) {
      a.type = c.type.trim();
      if (using.trim()) a.using = using.trim();
    }
    if (c.nullable !== column.nullable) a.nullable = c.nullable;
    // With a type change, always send the default: it is dropped and re-set around the change.
    if (!column.identity && (a.type !== undefined || c.default.trim() !== (column.default ?? '')))
      a.default = c.default.trim() || null;
    if (c.comment.trim() !== (column.comment ?? '')) a.comment = c.comment.trim() || null;
    return a;
  }, [c, column, using]);

  const statements = alterSql(meta.schema, meta.table, change);
  const errors = validateAlter(change);
  const typeChanged = editing && c.type.trim() !== column.type;
  const hasPk = meta.primaryKey.length > 0;

  return (
    <DialogShell
      title={editing ? 'Edit column' : 'Add column'}
      description={
        <span className="font-mono text-xs">
          {meta.schema}.{meta.table}
          {editing && `.${column.name}`}
        </span>
      }
      statements={statements}
      errors={errors}
      error={alter.error}
      pending={alter.isPending}
      confirm={editing ? 'Save changes' : 'Add column'}
      onClose={onClose}
      onSubmit={() => alter.mutate(change)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="col-name">
          <Input
            id="col-name"
            value={c.name}
            onChange={(e) => set({ name: e.target.value })}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
          />
        </Field>
        <Field label="Type">
          <Combobox
            value={c.type}
            onChange={(type) => set({ type })}
            options={typeOptions}
            mono
            creatable
            searchPlaceholder="Type or search…"
            className="h-9 w-full"
            aria-label="Type"
          />
        </Field>
      </div>
      {typeChanged && (
        <Field
          label="Convert existing values with (optional)"
          htmlFor="col-using"
          hint={
            <>
              A USING expression, e.g.{' '}
              <span className="font-mono">{`${column!.name}::${c.type.trim() || 'type'}`}</span>. Needed when Postgres
              can't cast automatically.
            </>
          }
        >
          <Input
            id="col-using"
            value={using}
            onChange={(e) => setUsing(e.target.value)}
            placeholder={`${column!.name}::${c.type.trim()}`}
            spellCheck={false}
            className="font-mono text-xs"
          />
        </Field>
      )}
      <Field
        label="Default"
        htmlFor="col-default"
        hint={
          column?.identity
            ? 'Identity column: values are generated automatically.'
            : "A SQL expression, e.g. now(), 0 or 'draft'. Leave empty for none."
        }
      >
        <Input
          id="col-default"
          value={c.default}
          onChange={(e) => set({ default: e.target.value })}
          disabled={c.identity || column?.identity}
          list="col-default-list"
          placeholder={c.identity || column?.identity ? 'auto' : 'none'}
          spellCheck={false}
          autoComplete="off"
          className="font-mono text-xs"
        />
        <datalist id="col-default-list">
          {defaultSuggestions(c.type).map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      </Field>
      <div className="space-y-1.5">
        <Label className="text-xs">Constraints</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {!editing && (
            <Flag
              on={c.primaryKey}
              onToggle={() => set({ primaryKey: !c.primaryKey })}
              title={hasPk ? 'This table already has a primary key' : 'Primary key'}
              disabled={hasPk}
            >
              PK
            </Flag>
          )}
          <Flag
            on={!c.nullable}
            onToggle={() => set({ nullable: !c.nullable })}
            title="Not null"
            disabled={c.primaryKey}
          >
            NOT NULL
          </Flag>
          {!editing && (
            <>
              <Flag on={c.unique} onToggle={() => set({ unique: !c.unique })} title="Unique" disabled={c.primaryKey}>
                UNIQUE
              </Flag>
              <Flag
                on={c.identity}
                onToggle={() => set({ identity: !c.identity })}
                title="Auto-increment (identity)"
                disabled={!isIntegerType(c.type)}
              >
                AUTO-INCREMENT
              </Flag>
              <ReferencePicker
                db={db}
                value={c.references}
                onChange={(references, refType) =>
                  set({ references, ...(references && refType ? { type: refType, identity: false } : {}) })
                }
              />
            </>
          )}
        </div>
        {!editing && !c.nullable && !c.default.trim() && !c.identity && meta.estimate > 0 && (
          <p className="text-[11px] text-warning">
            The table has rows: a NOT NULL column needs a default, or adding it will fail.
          </p>
        )}
      </div>
      <Field label="Comment" htmlFor="col-comment">
        <Input
          id="col-comment"
          value={c.comment}
          onChange={(e) => set({ comment: e.target.value })}
          placeholder="What this column holds"
        />
      </Field>
    </DialogShell>
  );
}

/** Create an index: ordered columns with ASC/DESC, method, unique, partial WHERE, concurrently. */
export function IndexDialog({ db, meta, onClose }: { db: string; meta: TableMeta; onClose: () => void }) {
  const alter = useAlter(db, meta.schema, meta.table, onClose);
  const [name, setName] = useState('');
  const [cols, setCols] = useState<{ name: string; desc: boolean }[]>([]);
  const [unique, setUnique] = useState(false);
  const [method, setMethod] = useState<IndexMethod>('btree');
  const [concurrently, setConcurrently] = useState(true);
  const [where, setWhere] = useState('');

  const toggle = (col: string) =>
    setCols((prev) =>
      prev.some((c) => c.name === col) ? prev.filter((c) => c.name !== col) : [...prev, { name: col, desc: false }],
    );
  const change: AlterAction = {
    action: 'createIndex',
    name: name.trim(),
    columns: cols,
    unique,
    method,
    concurrently,
    where,
  };
  const statements = cols.length ? alterSql(meta.schema, meta.table, change) : [];
  const errors = validateAlter(change);
  const suggested = cols.length
    ? `${meta.table}_${cols.map((c) => c.name).join('_')}_${unique ? 'key' : 'idx'}`.slice(0, 63)
    : 'auto';

  return (
    <DialogShell
      title="Add index"
      description={<span className="font-mono text-xs">{`${meta.schema}.${meta.table}`}</span>}
      statements={statements}
      errors={errors}
      error={alter.error}
      pending={alter.isPending}
      confirm="Create index"
      onClose={onClose}
      onSubmit={() => alter.mutate(change)}
    >
      <Field label="Columns" hint="Click in the order the index should use. The arrow sets ascending / descending.">
        <div className="max-h-56 divide-y overflow-y-auto rounded-md border">
          {meta.columns.map((col) => {
            const pos = cols.findIndex((c) => c.name === col.name);
            const sel = pos >= 0 ? cols[pos]! : null;
            return (
              <div key={col.name} className={cn('flex h-9 items-center gap-2 px-2.5 text-sm', sel && 'bg-muted/50')}>
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <Checkbox checked={!!sel} onCheckedChange={() => toggle(col.name)} />
                  <span className="truncate font-mono text-[13px]">{col.name}</span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">{col.type}</span>
                </label>
                {sel && (
                  <>
                    <span className="rounded bg-primary px-1.5 font-mono text-[10px] text-primary-foreground tabular-nums">
                      {pos + 1}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-1.5 font-mono text-[11px]"
                      onClick={() =>
                        setCols((prev) => prev.map((c) => (c.name === col.name ? { ...c, desc: !c.desc } : c)))
                      }
                    >
                      {sel.desc ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
                      {sel.desc ? 'DESC' : 'ASC'}
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name (optional)" htmlFor="idx-name">
          <Input
            id="idx-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={suggested}
            spellCheck={false}
            autoComplete="off"
            className="font-mono text-xs"
          />
        </Field>
        <Field label="Method">
          <Select value={method} onValueChange={(v) => setMethod(v as IndexMethod)}>
            <SelectTrigger className="w-full font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INDEX_METHODS.map((m) => (
                <SelectItem key={m} value={m} className="font-mono text-xs">
                  {m}
                  <span className="ml-2 font-sans text-muted-foreground">
                    {m === 'btree'
                      ? 'default, sorting & ranges'
                      : m === 'gin'
                        ? 'jsonb, arrays, full-text'
                        : m === 'gist'
                          ? 'geometry, ranges'
                          : m === 'brin'
                            ? 'huge, naturally ordered'
                            : m === 'hash'
                              ? 'equality only'
                              : 'partitioned data'}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Only rows where (optional)" htmlFor="idx-where" hint="A partial index, e.g. deleted_at IS NULL.">
        <Input
          id="idx-where"
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          placeholder="none"
          spellCheck={false}
          className="font-mono text-xs"
        />
      </Field>
      <div className="space-y-2.5">
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={unique}
            disabled={method !== 'btree'}
            onCheckedChange={(v) => setUnique(v === true)}
          />
          <span>
            Unique
            <span className="block text-xs text-muted-foreground">Reject rows that repeat these values.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox className="mt-0.5" checked={concurrently} onCheckedChange={(v) => setConcurrently(v === true)} />
          <span>
            Build concurrently
            <span className="block text-xs text-muted-foreground">
              Slower, but doesn't block writes to the table while it builds.
            </span>
          </span>
        </label>
      </div>
    </DialogShell>
  );
}

/** Confirm dropping a column, index or constraint. */
export function DropStructureDialog({
  db,
  meta,
  target,
  onClose,
}: {
  db: string;
  meta: TableMeta;
  target: { kind: 'column' | 'index' | 'constraint'; name: string };
  onClose: () => void;
}) {
  const alter = useAlter(db, meta.schema, meta.table, onClose);
  const [cascade, setCascade] = useState(false);
  const [concurrently, setConcurrently] = useState(false);
  const change: AlterAction =
    target.kind === 'column'
      ? { action: 'dropColumn', column: target.name, cascade }
      : target.kind === 'index'
        ? { action: 'dropIndex', name: target.name, cascade, concurrently }
        : { action: 'dropConstraint', name: target.name, cascade };
  const what =
    target.kind === 'column'
      ? 'The column and all of its values will be permanently deleted.'
      : target.kind === 'index'
        ? 'Queries that used it may get slower. Data is not affected.'
        : 'The rule it enforces stops applying. Data is not affected.';

  return (
    <AlertDialog open onOpenChange={(o) => !o && !alter.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Drop {target.kind}?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono break-all text-foreground">{target.name}</span> on {meta.schema}.{meta.table}.{' '}
            {what}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2.5">
          {target.kind === 'index' && (
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={concurrently}
                onCheckedChange={(v) => setConcurrently(v === true)}
              />
              <span>
                Concurrently
                <span className="block text-xs text-muted-foreground">
                  Don't block the table while dropping. Can't be combined with cascade.
                </span>
              </span>
            </label>
          )}
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={cascade}
              disabled={concurrently}
              onCheckedChange={(v) => setCascade(v === true)}
            />
            <span>
              Cascade
              <span className="block text-xs text-muted-foreground">
                Also drop views, indexes and constraints that depend on it.
              </span>
            </span>
          </label>
          <pre className="overflow-x-auto rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs">
            {alterSql(meta.schema, meta.table, change).join('\n')}
          </pre>
          {alter.isError && <p className="text-sm text-destructive">{errorMessage(alter.error)}</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={alter.isPending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={alter.isPending} onClick={() => alter.mutate(change)}>
            {alter.isPending && <Spinner className="text-current" />}
            Drop {target.kind}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
