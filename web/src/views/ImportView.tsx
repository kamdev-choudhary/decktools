import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, FileUp, Loader2, Upload, X, XCircle } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ImportResponse } from '@shared/export';
import type { TableRef } from '@shared/types';
import { keys, useInfo, useMeta, useTables } from '@/api/hooks';
import { errorMessage, ErrorAlert, Spinner } from '@/components/app/feedback';
import { Combobox } from '@/components/app/Combobox';
import { ImportSettings, type ImportPlan } from '@/components/app/import/ImportSettings';
import { UploadProgress, type Progress } from '@/components/app/import/UploadProgress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatBytes, formatNumber } from '@/lib/format';
import { uploadImport, UploadCancelled } from '@/lib/import-upload';
import { tableHref } from '@/lib/router';
import { cn } from '@/lib/utils';

type Status = 'ready' | 'uploading' | 'done' | 'failed' | 'cancelled';

interface Target {
  schema: string;
  table: string;
}

interface Item {
  id: number;
  file: File;
  target: Target | null;
  /** True when the target was picked automatically from the file name. */
  matched: boolean;
  plan: ImportPlan | null;
  problem: string | null;
  open: boolean;
  status: Status;
  progress?: Progress;
  result?: ImportResponse;
  error?: unknown;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s\-.]+/g, '_');

/** "public.Orders 2024.csv.gz" → table candidates by name. */
function matchTable(fileName: string, tables: TableRef[]): Target | null {
  const base = fileName.replace(/\.gz$/i, '').replace(/\.[^.]+$/, '');
  const writable = tables.filter((t) => t.kind === 'r' || t.kind === 'p');
  // schema.table in the file name
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
    const added = [...files].map((file): Item => {
      const target = matchTable(file.name, tables.data ?? []);
      return { id: nextId++, file, target, matched: !!target, plan: null, problem: null, open: !target, status: 'ready' };
    });
    setItems((list) => [...list, ...added]);
  };

  const pending = items.filter((it) => it.status !== 'done');
  const blocked = pending.filter((it) => !it.target || !it.plan);
  const replacing = pending.filter((it) => it.plan?.truncate).length;
  const totalBytes = pending.reduce((s, it) => s + it.file.size, 0);

  const runAll = async () => {
    setRunning(true);
    stopRef.current = false;
    let ok = 0;
    let rows = 0;
    let failed = 0;
    for (const it of items) {
      if (stopRef.current) break;
      if (it.status === 'done' || !it.plan || !it.target) continue;
      const startedAt = performance.now();
      update(it.id, { status: 'uploading', progress: { loaded: 0, total: it.file.size, startedAt }, error: undefined });
      const job = uploadImport(db, it.file, it.plan.params, (loaded, total) =>
        update(it.id, { progress: { loaded, total, startedAt } }),
      );
      abortRef.current = job.abort;
      try {
        const result = await job.promise;
        update(it.id, { status: 'done', result, open: false, progress: undefined });
        ok++;
        rows += result.rowCount;
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
                Drop files and each one goes into the table with the same name, e.g. <span className="font-mono text-foreground">users.csv</span> →{' '}
                <span className="font-mono text-foreground">users</span>.
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

          {readonly && (
            <ErrorAlert error={new Error('pgdeck is running with --readonly, so importing is disabled.')} title="Read-only" />
          )}

          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            accept=".csv,.tsv,.tab,.txt,.ndjson,.jsonl,.json,.gz"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
            {/* Main column: drop zone and the files */}
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
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    CSV, TSV or JSON Lines, optionally .gz. Several at once, any size.
                  </div>
                </div>
              </button>

              {items.length > 0 && (
                <ul className="space-y-3">
                  {items.map((it) => (
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
                  ))}
                </ul>
              )}
            </div>

            {/* Side panel: how it works */}
            <aside className="space-y-3 xl:sticky xl:top-0">
              <InfoCard title="Supported files">
                <ul className="space-y-1.5">
                  <li>
                    <b className="font-medium text-foreground">CSV</b>: any delimiter (detected), header row optional
                  </li>
                  <li>
                    <b className="font-medium text-foreground">TSV</b>: Postgres text format, <span className="font-mono">\N</span> for NULL
                  </li>
                  <li>
                    <b className="font-medium text-foreground">JSON Lines</b>: one object per line; extra keys can be skipped
                  </li>
                  <li>
                    Add <span className="font-mono">.gz</span> to any of them; it's decompressed on the server
                  </li>
                </ul>
              </InfoCard>
              <InfoCard title="How files are matched">
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
                  <li>Each file is one transaction: a bad row rolls that file back and tells you the line.</li>
                  <li>Files run top to bottom. Put referenced tables first (e.g. users before orders).</li>
                  <li>
                    <b className="font-medium text-destructive">Replace</b> empties the table before importing.
                  </li>
                  <li>Behind a proxy, raise its upload size and timeout limits for big files.</li>
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
          <CheckCircle2 /> {formatNumber(item.result?.rowCount ?? 0)} rows
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
      return !item.target || item.problem ? (
        <Badge variant="outline" className="gap-1 border-warning/40 text-warning">
          <AlertTriangle /> Needs attention
        </Badge>
      ) : (
        <Badge variant="secondary">Ready</Badge>
      );
  }
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
    <li className={cn('overflow-hidden rounded-lg border', item.status === 'failed' && 'border-destructive/40')}>
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
      {!t && item.status === 'ready' && (
        <p className="-mt-1 px-4 pb-3 pl-11 text-xs text-warning">No table matches this file name. Choose one.</p>
      )}

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

      {/* Settings stay mounted while collapsed so the plan keeps updating. */}
      {t && (
        <div className={cn('border-t bg-muted/20 px-4 py-4', !item.open && 'hidden')}>
          <TargetSettings key={key(t)} db={db} target={t} file={item.file} disabled={locked} onPlan={onPlan} />
        </div>
      )}
    </li>
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
  if (!(meta.data.kind === 'r' || meta.data.kind === 'p')) return <p className="text-sm text-destructive">{errorMessage(new Error('Only tables can be imported into.'))}</p>;
  return <ImportSettings file={file} meta={meta.data} disabled={disabled} onPlan={onPlan} />;
}
