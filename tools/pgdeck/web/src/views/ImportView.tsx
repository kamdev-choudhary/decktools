import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Database, FileUp, Loader2, Upload, X, XCircle } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ImportResponse, RestoreResponse } from '@shared/export';
import type { TableRef } from '@shared/types';
import { keys, useInfo, useMeta, useTables } from '@/api/hooks';
import { Combobox } from '@deck/ui/components/combobox';
import { ErrorAlert, Spinner } from '@/components/app/feedback';
import { ImportSettings, type ImportPlan } from '@/components/app/import/ImportSettings';
import { UploadProgress, type Progress } from '@/components/app/import/UploadProgress';
import { Badge } from '@deck/ui/components/badge';
import { Button } from '@deck/ui/components/button';
import { Checkbox } from '@deck/ui/components/checkbox';
import { detectFile, type DumpInfo, type FileKind } from '@/lib/dump-detect';
import { formatBytes, formatNumber } from '@/lib/format';
import { uploadFile, UploadCancelled } from '@/lib/import-upload';
import { tableHref } from '@/lib/router';
import { cn } from '@deck/ui/lib/utils';

type Status = 'ready' | 'uploading' | 'done' | 'failed' | 'cancelled';

interface Target {
  schema: string;
  table: string;
}

interface RestoreOpts {
  single: boolean;
  skipOwnership: boolean;
}

interface Item {
  id: number;
  file: File;
  /** null while the file is being inspected. */
  kind: FileKind | null;
  gzip: boolean;
  dump?: DumpInfo;
  restore: RestoreOpts;
  target: Target | null;
  /** True when the target was picked automatically from the file name. */
  matched: boolean;
  plan: ImportPlan | null;
  problem: string | null;
  open: boolean;
  status: Status;
  progress?: Progress;
  result?: { rows: number; tables?: number };
  error?: unknown;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s\-.]+/g, '_');
const isDump = (it: Item) => it.kind === 'dump-sql' || it.kind === 'dump-custom';

/** "public.Orders 2024.csv.gz" → the table with that name. */
function matchTable(fileName: string, tables: TableRef[]): Target | null {
  const base = fileName.replace(/\.gz$/i, '').replace(/\.[^.]+$/, '');
  const writable = tables.filter((t) => t.kind === 'r' || t.kind === 'p');
  const dot = base.indexOf('.');
  if (dot > 0) {
    const [s, t] = [base.slice(0, dot), base.slice(dot + 1)];
    const hit = writable.find((x) => norm(x.schema) === norm(s) && norm(x.name) === norm(t));
    if (hit) return { schema: hit.schema, table: hit.name };
  }
  const hits = writable.filter((x) => norm(x.name) === norm(base));
  const hit = hits.find((x) => x.schema === 'public') ?? hits[0];
  return hit ? { schema: hit.schema, table: hit.name } : null;
}

const key = (t: Target) => `${t.schema}.${t.table}`;

let nextId = 1;

export function ImportView({ db }: { db: string }) {
  const qc = useQueryClient();
  const info = useInfo(db);
  const tables = useTables(db);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const stopRef = useRef(false);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);

  const readonly = info.data?.readonly ?? false;
  const tableOptions = useMemo(
    () =>
      (tables.data ?? [])
        .filter((t) => t.kind === 'r' || t.kind === 'p')
        .map((t) => ({ value: `${t.schema}.${t.name}`, label: t.schema === 'public' ? t.name : `${t.schema}.${t.name}` })),
    [tables.data],
  );

  const update = (id: number, patch: Partial<Item>) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const addFiles = (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const added = [...files].map(
      (file): Item => ({
        id: nextId++,
        file,
        kind: null,
        gzip: false,
        restore: { single: true, skipOwnership: true },
        target: null,
        matched: false,
        plan: null,
        problem: null,
        open: false,
        status: 'ready',
      }),
    );
    setItems((list) => [...list, ...added]);
    // Inspect contents: dumps often have no telling extension.
    for (const it of added) {
      void detectFile(it.file).then((d) => {
        if (d.kind === 'table') {
          const target = matchTable(it.file.name, tables.data ?? []);
          update(it.id, { kind: 'table', gzip: d.gzip, target, matched: !!target, open: !target });
        } else {
          update(it.id, { kind: d.kind, gzip: d.gzip, dump: d.dump });
        }
      });
    }
  };

  const pending = items.filter((it) => it.status !== 'done');
  const blocked = pending.filter((it) => it.kind === null || (it.kind === 'table' && (!it.target || !it.plan)));
  const replacing = pending.filter((it) => it.kind === 'table' && it.plan?.truncate).length;
  const dumps = pending.filter(isDump).length;
  const totalBytes = pending.reduce((s, it) => s + it.file.size, 0);

  const runAll = async () => {
    setRunning(true);
    stopRef.current = false;
    let ok = 0;
    let rows = 0;
    let failed = 0;
    for (const it of items) {
      if (stopRef.current) break;
      if (it.status === 'done') continue;
      const startedAt = performance.now();
      const onProgress = (loaded: number, total: number) => update(it.id, { progress: { loaded, total, startedAt, at: performance.now() } });
      let job: { promise: Promise<ImportResponse | RestoreResponse>; abort: () => void };
      if (isDump(it)) {
        const params = new URLSearchParams({
          gzip: it.gzip ? '1' : '0',
          custom: it.kind === 'dump-custom' ? '1' : '0',
          single: it.restore.single ? '1' : '0',
          skipOwnership: it.restore.skipOwnership ? '1' : '0',
        });
        job = uploadFile<RestoreResponse>(db, 'restore', it.file, params, onProgress);
      } else if (it.plan) {
        job = uploadFile<ImportResponse>(db, 'import', it.file, it.plan.params, onProgress);
      } else continue;

      update(it.id, { status: 'uploading', progress: { loaded: 0, total: it.file.size, startedAt, at: startedAt }, error: undefined });
      abortRef.current = job.abort;
      try {
        const r = await job.promise;
        const result = 'copies' in r ? { rows: r.rows, tables: r.copies } : { rows: r.rowCount };
        update(it.id, { status: 'done', result, open: false, progress: undefined });
        ok++;
        rows += result.rows;
      } catch (e) {
        if (e instanceof UploadCancelled) {
          update(it.id, { status: 'cancelled', progress: undefined });
          break;
        }
        update(it.id, { status: 'failed', error: e, open: true, progress: undefined });
        failed++;
      } finally {
        abortRef.current = null;
      }
    }
    setRunning(false);
    void qc.invalidateQueries({ queryKey: keys.db(db) });
    if (ok) toast.success(`Imported ${formatNumber(rows)} rows from ${ok} file${ok > 1 ? 's' : ''}`);
    if (failed) toast.error(`${failed} file${failed > 1 ? 's' : ''} failed. Nothing from ${failed > 1 ? 'those files' : 'that file'} was imported.`);
  };

  const stop = () => {
    stopRef.current = true;
    abortRef.current?.();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-6 px-4 py-6 md:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">Import data</h1>
              <p className="text-sm text-muted-foreground">
                Drop table files (<span className="font-mono text-foreground">users.csv</span> → <span className="font-mono text-foreground">users</span>) or a whole
                database backup from <span className="font-mono text-foreground">pg_dump</span>.
              </p>
            </div>
            {items.length > 0 && (
              <div className="flex gap-2 text-xs text-muted-foreground">
                {(['ready', 'done', 'failed'] as const).map((st) => {
                  const n = items.filter((it) => it.status === st).length;
                  return n ? (
                    <Badge key={st} variant="outline" className="tabular-nums">
                      {n} {st === 'ready' ? 'waiting' : st === 'done' ? 'imported' : 'failed'}
                    </Badge>
                  ) : null;
                })}
              </div>
            )}
          </div>

          {readonly && <ErrorAlert error={new Error('pgdeck is running with --readonly, so importing is disabled.')} title="Read-only" />}

          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-3">
              <button
                type="button"
                disabled={readonly || running || tables.isPending}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!readonly && !running) addFiles(e.dataTransfer.files);
                }}
                className={cn(
                  'flex w-full items-center rounded-lg border border-dashed transition-colors hover:bg-muted/40 disabled:pointer-events-none disabled:opacity-50',
                  items.length ? 'gap-3 px-4 py-4 text-left' : 'min-h-72 flex-col justify-center gap-3 px-6 py-16 text-center',
                  dragging && 'border-foreground bg-muted/60',
                )}
              >
                <FileUp className={cn('shrink-0 text-muted-foreground', items.length ? 'size-5' : 'size-8')} />
                <div>
                  <div className="text-sm font-medium">{items.length ? 'Add more files' : 'Drop files here, or click to browse'}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">CSV, TSV, JSON Lines or database backups (.sql, .dump), optionally .gz. Any size.</div>
                </div>
              </button>

              {items.length > 0 && (
                <ul className="space-y-3">
                  {items.map((it) =>
                    it.kind === null ? (
                      <li key={it.id} className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm">
                        <Spinner /> <span className="truncate">{it.file.name}</span>
                        <span className="text-xs text-muted-foreground">Inspecting…</span>
                      </li>
                    ) : isDump(it) ? (
                      <DumpCard
                        key={it.id}
                        db={db}
                        item={it}
                        busy={running}
                        onOptions={(restore) => update(it.id, { restore })}
                        onToggle={() => update(it.id, { open: !it.open })}
                        onRemove={() => setItems((list) => list.filter((x) => x.id !== it.id))}
                      />
                    ) : (
                      <FileCard
                        key={it.id}
                        db={db}
                        item={it}
                        tableOptions={tableOptions}
                        busy={running}
                        onTarget={(t) => update(it.id, { target: t, matched: false, plan: null, problem: null, open: true })}
                        onPlan={(plan, problem) => update(it.id, { plan, problem })}
                        onToggle={() => update(it.id, { open: !it.open })}
                        onRemove={() => setItems((list) => list.filter((x) => x.id !== it.id))}
                      />
                    ),
                  )}
                </ul>
              )}
            </div>

            <aside className="space-y-3 xl:sticky xl:top-0">
              <InfoCard title="Supported files">
                <ul className="space-y-1.5">
                  <li>
                    <b className="font-medium text-foreground">CSV / TSV / JSON Lines</b>: data for one table each
                  </li>
                  <li>
                    <b className="font-medium text-foreground">Database backups</b>: <span className="font-mono">pg_dump</span> plain SQL (.sql) or custom format
                    (.dump), restoring all their tables at once
                  </li>
                  <li>
                    Any of them gzipped (<span className="font-mono">.gz</span>). Files are recognised by their content, not only their name.
                  </li>
                </ul>
              </InfoCard>
              <InfoCard title="How table files are matched">
                <ul className="space-y-1.5">
                  <li>
                    <span className="font-mono text-foreground">orders.csv</span> → <span className="font-mono text-foreground">orders</span>
                  </li>
                  <li>
                    <span className="font-mono text-foreground">sales.orders.csv.gz</span> → <span className="font-mono text-foreground">sales.orders</span>
                  </li>
                  <li>Case, spaces and dashes are ignored. Columns are matched by name; review them with ⌄.</li>
                </ul>
              </InfoCard>
              <InfoCard title="Good to know">
                <ul className="space-y-1.5">
                  <li>Each file is one transaction: an error rolls that file back and tells you the line.</li>
                  <li>Backups create their tables, so restore into an empty database (or one without those tables).</li>
                  <li>
                    Custom-format backups need <span className="font-mono">pg_restore</span> installed where pgdeck runs.
                  </li>
                  <li>Files run top to bottom. Put referenced tables first (e.g. users before orders).</li>
                </ul>
              </InfoCard>
            </aside>
          </div>
        </div>
      </div>

      {items.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-background px-4 py-3 md:px-8">
          <p className="text-xs text-muted-foreground">
            {pending.length
              ? `${pending.length} file${pending.length > 1 ? 's' : ''} · ${formatBytes(totalBytes)}. Each file is imported in its own transaction.`
              : 'All files imported.'}
            {blocked.length > 0 && <span className="text-warning"> {blocked.length} need attention.</span>}
            {replacing > 0 && <span className="text-destructive"> {replacing} will replace existing data.</span>}
            {dumps > 0 && (
              <span className="text-foreground">
                {' '}
                {dumps} backup{dumps > 1 ? 's' : ''} will be restored into <span className="font-mono">{db}</span>.
              </span>
            )}
          </p>
          <div className="flex gap-2">
            {!running && items.some((it) => it.status === 'done') && (
              <Button variant="ghost" onClick={() => setItems((list) => list.filter((x) => x.status !== 'done'))}>
                Clear finished
              </Button>
            )}
            {running ? (
              <Button variant="outline" onClick={stop}>
                <X /> Stop
              </Button>
            ) : (
              pending.length > 0 && (
                <Button onClick={() => void runAll()} disabled={readonly || blocked.length > 0}>
                  <Upload /> Import {pending.length > 1 ? `${pending.length} files` : 'file'}
                </Button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-4 text-xs leading-relaxed text-muted-foreground">
      <h2 className="mb-2 text-sm font-medium text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function StatusBadge({ item }: { item: Item }) {
  switch (item.status) {
    case 'uploading':
      return (
        <Badge variant="outline" className="gap-1">
          <Loader2 className="animate-spin" /> Importing
        </Badge>
      );
    case 'done':
      return (
        <Badge variant="outline" className="gap-1 border-success/40 text-success">
          <CheckCircle2 /> {formatNumber(item.result?.rows ?? 0)} rows
          {item.result?.tables !== undefined && ` · ${item.result.tables} tables`}
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
          <XCircle /> Failed
        </Badge>
      );
    case 'cancelled':
      return <Badge variant="outline">Cancelled</Badge>;
    default:
      return item.kind === 'table' && (!item.target || item.problem) ? (
        <Badge variant="outline" className="gap-1 border-warning/40 text-warning">
          <AlertTriangle /> Needs attention
        </Badge>
      ) : (
        <Badge variant="secondary">Ready</Badge>
      );
  }
}

function CardShell({ item, children }: { item: Item; children: React.ReactNode }) {
  return (
    <li className={cn('overflow-hidden rounded-lg border', item.status === 'failed' && 'border-destructive/40')}>
      {children}
      {item.progress && (
        <div className="border-t px-4 py-3">
          <UploadProgress progress={item.progress} />
        </div>
      )}
      {item.status === 'failed' && (
        <div className="border-t px-4 py-3">
          <ErrorAlert error={item.error} title="Nothing from this file was imported." />
        </div>
      )}
    </li>
  );
}

/* ---------------------------------------------------------------- */
/* Database backup                                                   */
/* ---------------------------------------------------------------- */

interface DumpCardProps {
  db: string;
  item: Item;
  busy: boolean;
  onOptions: (o: RestoreOpts) => void;
  onToggle: () => void;
  onRemove: () => void;
}

function DumpCard({ db, item, busy, onOptions, onToggle, onRemove }: DumpCardProps) {
  const d = item.dump;
  const locked = busy || item.status === 'done' || item.status === 'uploading';
  const shown = d?.tables.slice(0, 40) ?? [];
  return (
    <CardShell item={item}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <Database className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 basis-48">
          <div className="truncate text-sm font-medium" title={item.file.name}>
            {item.file.name}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {formatBytes(item.file.size)} · {item.kind === 'dump-custom' ? 'pg_dump custom format' : 'SQL backup'}
            {item.gzip && ' · gzip'}
            {d?.source && item.kind !== 'dump-custom' && ` · ${d.source}`}
            {d && d.tables.length > 0 && ` · ${d.tables.length}${d.partial ? '+' : ''} tables`}
          </div>
        </div>
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
        <Badge variant="outline" className="h-8 shrink-0 gap-1.5 px-3 font-mono text-xs">
          <Database className="size-3.5" /> whole database → {db}
        </Badge>
        <StatusBadge item={item} />
        <div className="flex shrink-0 items-center">
          <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label={item.open ? 'Hide options' : 'Review options'}>
            <ChevronDown className={cn('transition-transform', item.open && 'rotate-180')} />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Remove file" disabled={item.status === 'uploading'}>
            <X />
          </Button>
        </div>
      </div>
      {item.status === 'ready' && !item.open && (
        <p className="-mt-1 px-4 pb-3 pl-11 text-[11px] text-muted-foreground">
          Database backup: restores all its tables, data, indexes and constraints at once. No table to pick.
        </p>
      )}
      <div className={cn('space-y-4 border-t bg-muted/20 px-4 py-4', !item.open && 'hidden')}>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={item.restore.single} disabled={locked} onCheckedChange={(v) => onOptions({ ...item.restore, single: v === true })} />
            <span>
              Single transaction
              <span className="block text-xs text-muted-foreground">Any error rolls back the whole restore.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={item.restore.skipOwnership}
              disabled={locked}
              onCheckedChange={(v) => onOptions({ ...item.restore, skipOwnership: v === true })}
            />
            <span>
              Skip ownership and privileges
              <span className="block text-xs text-muted-foreground">Ignore OWNER TO / GRANT for roles that may not exist here.</span>
            </span>
          </label>
        </div>
        {shown.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">Tables found{d?.partial ? ' in the first part of the file' : ''}:</div>
            <div className="flex flex-wrap gap-1">
              {shown.map((t) => (
                <span key={t} className="rounded border bg-background px-1.5 py-0.5 font-mono text-[11px]">
                  {t}
                </span>
              ))}
              {(d?.tables.length ?? 0) > shown.length && (
                <span className="px-1 py-0.5 text-[11px] text-muted-foreground">+{d!.tables.length - shown.length} more</span>
              )}
            </div>
          </div>
        )}
      </div>
    </CardShell>
  );
}

/* ---------------------------------------------------------------- */
/* Table file                                                        */
/* ---------------------------------------------------------------- */

interface FileCardProps {
  db: string;
  item: Item;
  tableOptions: { value: string; label: string }[];
  busy: boolean;
  onTarget: (t: Target) => void;
  onPlan: (plan: ImportPlan | null, problem: string | null) => void;
  onToggle: () => void;
  onRemove: () => void;
}

function FileCard({ db, item, tableOptions, busy, onTarget, onPlan, onToggle, onRemove }: FileCardProps) {
  const t = item.target;
  const locked = busy || item.status === 'done' || item.status === 'uploading';
  const summary = item.plan
    ? `${item.plan.columns} column${item.plan.columns === 1 ? '' : 's'} · ${item.plan.params.get('format')?.toUpperCase()}${
        item.plan.params.get('gzip') === '1' ? ' · gzip' : ''
      } · ${item.plan.truncate ? 'replace' : 'append'}`
    : item.problem;

  return (
    <CardShell item={item}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <FileUp className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 basis-48">
          <div className="truncate text-sm font-medium" title={item.file.name}>
            {item.file.name}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {formatBytes(item.file.size)}
            {summary && <span className={cn(!item.plan && t && 'text-warning')}> · {summary}</span>}
          </div>
        </div>
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="flex w-56 shrink-0 items-center gap-1.5">
          <Combobox
            value={t ? key(t) : undefined}
            onChange={(v) => {
              const dot = v.indexOf('.');
              onTarget({ schema: v.slice(0, dot), table: v.slice(dot + 1) });
            }}
            options={tableOptions}
            placeholder="Choose a table…"
            searchPlaceholder="Search tables…"
            mono
            disabled={locked}
            className={cn('flex-1', !t && 'border-warning/60')}
          />
        </div>
        <StatusBadge item={item} />
        <div className="flex shrink-0 items-center">
          <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label={item.open ? 'Hide options' : 'Review options'} disabled={!t}>
            <ChevronDown className={cn('transition-transform', item.open && 'rotate-180')} />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Remove file" disabled={item.status === 'uploading'}>
            <X />
          </Button>
        </div>
      </div>

      {item.matched && t && item.status === 'ready' && !item.open && (
        <p className="-mt-1 px-4 pb-3 pl-11 text-[11px] text-muted-foreground">
          Matched by file name to{' '}
          <a href={tableHref(db, t.schema, t.table)} className="font-mono text-link hover:underline">
            {key(t)}
          </a>
        </p>
      )}
      {!t && item.status === 'ready' && <p className="-mt-1 px-4 pb-3 pl-11 text-xs text-warning">No table matches this file name. Choose one.</p>}

      {/* Settings stay mounted while collapsed so the plan keeps updating. */}
      {t && (
        <div className={cn('border-t bg-muted/20 px-4 py-4', !item.open && 'hidden')}>
          <TargetSettings key={key(t)} db={db} target={t} file={item.file} disabled={locked} onPlan={onPlan} />
        </div>
      )}
    </CardShell>
  );
}

function TargetSettings({
  db,
  target,
  file,
  disabled,
  onPlan,
}: {
  db: string;
  target: Target;
  file: File;
  disabled: boolean;
  onPlan: (plan: ImportPlan | null, problem: string | null) => void;
}) {
  const meta = useMeta(db, target.schema, target.table);
  if (meta.isPending)
    return (
      <div className="flex justify-center p-4">
        <Spinner />
      </div>
    );
  if (meta.isError) return <ErrorAlert error={meta.error} />;
  if (!(meta.data.kind === 'r' || meta.data.kind === 'p')) return <p className="text-sm text-destructive">Only tables can be imported into.</p>;
  return <ImportSettings file={file} meta={meta.data} disabled={disabled} onPlan={onPlan} />;
}
