import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronDown, Link2, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { createTableSql, emptyColumn, FK_ACTIONS, isIntegerType, validateTable, type FkAction, type NewColumn } from '@shared/create-table';
import { api } from '@/api/client';
import { keys, useTables } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { navigate, tableHref } from '@/lib/router';
import { cn } from '@/lib/utils';
import { Combobox, type ComboOption } from './Combobox';
import { errorMessage, Spinner } from './feedback';

const COMMON_TYPES: ComboOption[] = [
  { value: 'text', hint: 'string' },
  { value: 'varchar(255)', hint: 'string, max length' },
  { value: 'integer', hint: '4-byte int' },
  { value: 'bigint', hint: '8-byte int' },
  { value: 'smallint', hint: '2-byte int' },
  { value: 'numeric(12,2)', hint: 'exact decimal' },
  { value: 'double precision', hint: 'float' },
  { value: 'real', hint: 'float4' },
  { value: 'boolean', hint: 'true / false' },
  { value: 'timestamptz', hint: 'date + time + zone' },
  { value: 'timestamp', hint: 'date + time' },
  { value: 'date', hint: 'calendar date' },
  { value: 'time', hint: 'time of day' },
  { value: 'interval', hint: 'duration' },
  { value: 'uuid', hint: 'unique id' },
  { value: 'jsonb', hint: 'JSON (binary)' },
  { value: 'json', hint: 'JSON (text)' },
  { value: 'bytea', hint: 'binary' },
  { value: 'text[]', hint: 'array of text' },
  { value: 'integer[]', hint: 'array of int' },
  { value: 'inet', hint: 'IP address' },
  { value: 'citext', hint: 'case-insensitive (ext)' },
];

/** Default expressions worth suggesting for a type. */
function defaultSuggestions(type: string): string[] {
  const t = type.toLowerCase();
  if (t.startsWith('timestamp')) return ['now()', 'CURRENT_TIMESTAMP'];
  if (t === 'date') return ['CURRENT_DATE'];
  if (t.startsWith('time')) return ['CURRENT_TIME'];
  if (t === 'uuid') return ['gen_random_uuid()'];
  if (t === 'boolean' || t === 'bool') return ['false', 'true'];
  if (t.startsWith('json')) return [`'{}'`, `'[]'`];
  if (t.endsWith('[]')) return [`'{}'`];
  if (/int|numeric|decimal|double|real|serial/.test(t)) return ['0'];
  if (/text|char/.test(t)) return [`''`];
  return [];
}

type Col = NewColumn & { key: number };
let nextKey = 1;
const col = (over: Partial<NewColumn> = {}): Col => ({ ...emptyColumn(over), key: nextKey++ });

const starter = (): Col[] => [
  col({ name: 'id', type: 'bigint', identity: true, primaryKey: true, nullable: false }),
  col({ name: '', type: 'text' }),
  col({ name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' }),
];

function Flag({ on, onToggle, title, disabled, children }: { on: boolean; onToggle: () => void; title: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'h-8 shrink-0 rounded-md border px-2 font-mono text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-40',
        on ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

export function CreateTableDialog({ db, defaultSchema = 'public', onClose }: { db: string; defaultSchema?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: [...keys.db(db), 'catalog'], queryFn: () => api.catalog(db) });
  const [schema, setSchema] = useState(defaultSchema);
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [columns, setColumns] = useState<Col[]>(starter);
  const [showSql, setShowSql] = useState(false);
  const [touched, setTouched] = useState(false);

  const typeOptions = useMemo<ComboOption[]>(
    () => [...COMMON_TYPES, ...(catalog.data?.types ?? []).map((t) => ({ value: t.name, hint: t.kind }))],
    [catalog.data],
  );
  const schemaOptions = useMemo<ComboOption[]>(() => {
    const list = catalog.data?.schemas ?? [];
    return (list.includes(schema) ? list : [schema, ...list]).map((s) => ({ value: s }));
  }, [catalog.data, schema]);

  const spec = { schema, name: name.trim(), comment, columns: columns.map(({ key: _k, ...c }) => ({ ...c, name: c.name.trim() })) };
  const errors = validateTable(spec);
  const sql = createTableSql(spec);

  const create = useMutation({
    mutationFn: () => api.createTable(db, spec),
    onSuccess: (res) => {
      toast.success(res.message);
      void qc.invalidateQueries({ queryKey: keys.db(db) });
      navigate(tableHref(db, spec.schema, spec.name));
      onClose();
    },
  });

  const update = (key: number, patch: Partial<NewColumn>) =>
    setColumns((cols) =>
      cols.map((c) => {
        if (c.key !== key) return c;
        const next = { ...c, ...patch };
        // Keep the flags consistent with each other.
        if (patch.primaryKey) next.nullable = false;
        if (patch.identity) {
          next.default = '';
          next.nullable = false;
        }
        if (patch.type !== undefined && !isIntegerType(patch.type)) next.identity = false;
        return next;
      }),
    );
  const move = (i: number, d: -1 | 1) =>
    setColumns((cols) => {
      const next = [...cols];
      const [c] = next.splice(i, 1);
      next.splice(i + d, 0, c!);
      return next;
    });

  const submit = () => {
    setTouched(true);
    if (!errors.length) create.mutate();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>New table</DialogTitle>
            <DialogDescription>
              Define the columns. You can add indexes and more constraints later in the SQL editor.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr_1fr]">
              <div className="space-y-1.5">
                <Label className="text-xs">Schema</Label>
                <Combobox value={schema} onChange={setSchema} options={schemaOptions} mono creatable className="h-9 w-full" aria-label="Schema" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-table-name" className="text-xs">
                  Table name
                </Label>
                <Input
                  id="new-table-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. invoices"
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-table-comment" className="text-xs">
                  Description <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input id="new-table-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What's stored here" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  Columns <span className="font-normal text-muted-foreground">· {columns.length}</span>
                </h3>
                <p className="hidden text-[11px] text-muted-foreground md:block">
                  <span className="font-mono">PK</span> primary key · <span className="font-mono">NN</span> not null · <span className="font-mono">UQ</span> unique ·{' '}
                  <span className="font-mono">AI</span> auto-increment
                </p>
              </div>

              <div className="rounded-lg border">
                <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto] gap-2 border-b bg-muted/40 px-3 py-2 text-[11px] font-medium text-muted-foreground md:grid">
                  <span>Name</span>
                  <span>Type</span>
                  <span>Default</span>
                  <span className="w-[8.5rem]">Constraints</span>
                  <span className="w-[7.5rem]">References</span>
                  <span className="w-[5.25rem]" />
                </div>
                <div className="divide-y">
                  {columns.map((c, i) => {
                    const pkCount = columns.filter((x) => x.primaryKey).length;
                    const listId = `defaults-${c.key}`;
                    return (
                      <div
                        key={c.key}
                        className="grid grid-cols-2 items-center gap-2 px-3 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto]"
                      >
                        <Input
                          value={c.name}
                          onChange={(e) => update(c.key, { name: e.target.value })}
                          placeholder={`column_${i + 1}`}
                          aria-label={`Column ${i + 1} name`}
                          spellCheck={false}
                          autoComplete="off"
                          className="h-8 font-mono text-xs"
                        />
                        <Combobox
                          value={c.type}
                          onChange={(type) => update(c.key, { type })}
                          options={typeOptions}
                          mono
                          creatable
                          searchPlaceholder="Type or search…"
                          aria-label={`Column ${i + 1} type`}
                          className="w-full"
                        />
                        <Input
                          value={c.default}
                          onChange={(e) => update(c.key, { default: e.target.value })}
                          placeholder={c.identity ? 'auto' : 'none'}
                          disabled={c.identity}
                          list={listId}
                          aria-label={`Column ${i + 1} default`}
                          spellCheck={false}
                          autoComplete="off"
                          className="h-8 font-mono text-xs"
                        />
                        <datalist id={listId}>
                          {defaultSuggestions(c.type).map((d) => (
                            <option key={d} value={d} />
                          ))}
                        </datalist>
                        <div className="flex gap-1">
                          <Flag on={c.primaryKey} onToggle={() => update(c.key, { primaryKey: !c.primaryKey })} title={pkCount > 1 && c.primaryKey ? 'Part of a composite primary key' : 'Primary key'}>
                            PK
                          </Flag>
                          <Flag on={!c.nullable} onToggle={() => update(c.key, { nullable: !c.nullable })} title="Not null" disabled={c.primaryKey}>
                            NN
                          </Flag>
                          <Flag on={c.unique} onToggle={() => update(c.key, { unique: !c.unique })} title="Unique" disabled={c.primaryKey && pkCount === 1}>
                            UQ
                          </Flag>
                          <Flag
                            on={c.identity}
                            onToggle={() => update(c.key, { identity: !c.identity })}
                            title={isIntegerType(c.type) ? 'Auto-increment (identity)' : 'Auto-increment needs an integer type'}
                            disabled={!isIntegerType(c.type)}
                          >
                            AI
                          </Flag>
                        </div>
                        <ReferencePicker
                          db={db}
                          value={c.references}
                          onChange={(references, refType) =>
                            update(c.key, {
                              references,
                              // A FK column should have the referenced column's type (identity → plain integer).
                              ...(references && refType ? { type: refType, identity: false } : {}),
                              ...(references && !c.name.trim() ? { name: `${references.table.replace(/s$/, '')}_${references.column}` } : {}),
                            })
                          }
                        />
                        <div className="flex justify-end gap-0.5">
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                            <ArrowUp />
                          </Button>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Move down" disabled={i === columns.length - 1} onClick={() => move(i, 1)}>
                            <ArrowDown />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Remove column"
                            disabled={columns.length === 1}
                            onClick={() => setColumns((cols) => cols.filter((x) => x.key !== c.key))}
                            className="hover:text-destructive"
                          >
                            <X />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t p-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setColumns((cols) => [...cols, col()])}>
                    <Plus /> Add column
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border">
              <button
                type="button"
                onClick={() => setShowSql((v) => !v)}
                aria-expanded={showSql}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className={cn('size-3.5 transition-transform', !showSql && '-rotate-90')} />
                SQL preview
              </button>
              {showSql && <pre className="max-h-72 overflow-auto border-t bg-muted/30 px-4 py-3 font-mono text-xs leading-relaxed">{sql}</pre>}
            </div>
          </div>

          <DialogFooter className="items-center border-t px-6 py-4 sm:justify-between">
            <div className="min-w-0 flex-1 text-xs">
              {create.isError ? (
                <p className="max-h-20 overflow-auto font-mono whitespace-pre-wrap text-destructive">{errorMessage(create.error)}</p>
              ) : touched && errors.length ? (
                <p className="text-destructive">{errors[0]}</p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || (touched && errors.length > 0)}>
                {create.isPending && <Spinner className="text-current" />}
                Create table
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReferencePicker({
  db,
  value,
  onChange,
}: {
  db: string;
  value: NewColumn['references'];
  /** `type` is the referenced column's type, so the new column can match it. */
  onChange: (v: NewColumn['references'], type?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const tables = useTables(db);
  const [target, setTarget] = useState(value ? `${value.schema}.${value.table}` : '');
  const [column, setColumn] = useState(value?.column ?? '');
  const [onDelete, setOnDelete] = useState<FkAction>(value?.onDelete ?? 'NO ACTION');
  const picked = (tables.data ?? []).find((t) => `${t.schema}.${t.name}` === target);
  const meta = useQuery({
    queryKey: keys.meta(db, picked?.schema ?? '', picked?.name ?? ''),
    queryFn: () => api.meta(db, picked!.schema, picked!.name),
    enabled: !!picked,
  });
  const tableOptions = (tables.data ?? []).filter((t) => t.kind === 'r' || t.kind === 'p').map((t) => ({ value: `${t.schema}.${t.name}`, label: t.schema === 'public' ? t.name : undefined }));
  const columnOptions = picked && meta.data ? meta.data.columns.map((c) => ({ value: c.name, hint: c.type })) : [];

  const pickTable = (v: string) => {
    setTarget(v);
    setColumn('');
  };
  // Default to the target's single-column primary key once its columns load.
  if (picked && meta.data && !column && meta.data.primaryKey.length === 1) setColumn(meta.data.primaryKey[0]!);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn('h-8 w-[7.5rem] justify-start gap-1.5 px-2 text-xs font-normal', !value && 'text-muted-foreground')}
          title={value ? `References ${value.schema}.${value.table}(${value.column})` : 'Add a foreign key'}
        >
          <Link2 className="size-3.5 shrink-0" />
          <span className="truncate font-mono">{value ? `${value.table}.${value.column}` : 'None'}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="text-sm font-medium">Foreign key</div>
        <div className="space-y-1.5">
          <Label className="text-xs">Referenced table</Label>
          <Combobox value={target} onChange={pickTable} options={tableOptions} mono placeholder="Pick a table…" className="w-full" aria-label="Referenced table" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Column</Label>
          <Combobox
            value={column}
            onChange={setColumn}
            options={columnOptions}
            mono
            disabled={!picked}
            placeholder={picked && meta.isPending ? 'Loading…' : 'Pick a column…'}
            className="w-full"
            aria-label="Referenced column"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">When the referenced row is deleted</Label>
          <Select value={onDelete} onValueChange={(v) => setOnDelete(v as FkAction)}>
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FK_ACTIONS.map((a) => (
                <SelectItem key={a} value={a} className="text-xs">
                  {a === 'NO ACTION' ? 'Block (no action)' : a === 'RESTRICT' ? 'Block (restrict)' : a === 'CASCADE' ? 'Delete this row too (cascade)' : a === 'SET NULL' ? 'Set to null' : 'Set to default'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!value}
            onClick={() => {
              onChange(null);
              setTarget('');
              setColumn('');
              setOpen(false);
            }}
          >
            Remove
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!picked || !column}
            onClick={() => {
              const refType = meta.data?.columns.find((c) => c.name === column)?.type;
              onChange({ schema: picked!.schema, table: picked!.name, column, onDelete, onUpdate: 'NO ACTION' }, refType);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
