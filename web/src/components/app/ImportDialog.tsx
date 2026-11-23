import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FileUp, RefreshCw, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { IMPORT_FORMATS, type ImportFormat, type ImportResponse } from '@shared/export';
import type { ApiErrorBody, TableMeta } from '@shared/types';
import { ApiError, BASE } from '@/api/client';
import { keys } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatBytes, formatDuration, formatNumber } from '@/lib/format';
import { autoMap, buildPreview, detectFormat, readHead, sniffDelimiter, type FilePreview } from '@/lib/file-preview';
import { cn } from '@/lib/utils';
import { Combobox } from './Combobox';
import { ErrorAlert, Spinner } from './feedback';

const FORMAT_LABEL: Record<ImportFormat, string> = { csv: 'CSV', tsv: 'TSV (Postgres text)', ndjson: 'JSON Lines' };
const DELIMITERS = [
  { value: ',', label: 'Comma  ,' },
  { value: ';', label: 'Semicolon  ;' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe  |' },
];
const SKIP = '__skip__';

interface Progress {
  loaded: number;
  total: number;
  startedAt: number;
}

interface ImportDialogProps {
  db: string;
  meta: TableMeta;
  onClose: () => void;
}

export function ImportDialog({ db, meta, onClose }: ImportDialogProps) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<ImportFormat>('csv');
  const [gzip, setGzip] = useState(false);
  const [delimiter, setDelimiter] = useState(',');
  const [header, setHeader] = useState(true);
  const [truncate, setTruncate] = useState(false);
  const [head, setHead] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<unknown>(null);

  const tableColumns = meta.columns.filter((c) => !c.generated).map((c) => c.name);
  const uploading = progress !== null;

  // Read the first few KB whenever the file (or its compression) changes.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setHead(null);
    setReadError(null);
    readHead(file, gzip)
      .then((text) => {
        if (cancelled) return;
        setHead(text);
        if (format === 'csv') setDelimiter(sniffDelimiter(text));
      })
      .catch((e: Error) => !cancelled && setReadError(gzip ? `Couldn't decompress the file: ${e.message}` : e.message));
    return () => {
      cancelled = true;
    };
    // format is read once on file change for delimiter sniffing only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, gzip]);

  // Re-parse the preview when parsing options change, and re-derive the mapping.
  useEffect(() => {
    if (head === null) return;
    const p = buildPreview(head, format, delimiter, header);
    setPreview(p);
    setMapping(autoMap(p.columns, tableColumns, format !== 'ndjson').map((m) => (m === '' && format === 'ndjson' ? SKIP : m)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [head, format, delimiter, header]);

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    const detected = detectFormat(f.name);
    setFile(f);
    setFormat(detected.format);
    setGzip(detected.gzip);
    setHeader(detected.format !== 'ndjson');
    setError(null);
  };

  const mapped = mapping.map((m, i) => ({ fileColumn: preview?.columns[i] ?? '', target: m })).filter((m) => m.target && m.target !== SKIP);
  const duplicate = mapped.find((m, i) => mapped.findIndex((x) => x.target === m.target) !== i);
  const unmappedCsv = format !== 'ndjson' && mapping.some((m) => !m || m === SKIP);
  const problem = !preview?.columns.length
    ? 'No columns found in the file.'
    : !mapped.length
      ? 'Map at least one column.'
      : duplicate
        ? `"${duplicate.target}" is mapped more than once.`
        : unmappedCsv
          ? 'Every file column needs a target column (COPY reads them all).'
          : null;

  const start = () => {
    if (!file || problem) return;
    const params = new URLSearchParams({
      schema: meta.schema,
      table: meta.table,
      format,
      columns: JSON.stringify(mapped.map((m) => m.target)),
      header: header && format !== 'ndjson' ? '1' : '0',
      delimiter,
      gzip: gzip ? '1' : '0',
      truncate: truncate ? '1' : '0',
    });
    if (format === 'ndjson') params.set('keys', JSON.stringify(mapped.map((m) => m.fileColumn)));

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', `${BASE}api/db/${encodeURIComponent(db)}/import?${params}`);
    xhr.setRequestHeader('x-pgdeck', '1');
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    const startedAt = performance.now();
    setProgress({ loaded: 0, total: file.size, startedAt });
    setError(null);
    xhr.upload.onprogress = (e) => setProgress({ loaded: e.loaded, total: e.total || file.size, startedAt });
    xhr.onload = () => {
      xhrRef.current = null;
      let body: ImportResponse | ApiErrorBody;
      try {
        body = JSON.parse(xhr.responseText) as ImportResponse | ApiErrorBody;
      } catch {
        body = { error: `${xhr.status} ${xhr.statusText}` };
      }
      setProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        const r = body as ImportResponse;
        toast.success(`Imported ${formatNumber(r.rowCount)} rows into ${meta.table}`, {
          description: `${formatBytes(r.bytes)} in ${(r.ms / 1000).toFixed(1)}s`,
        });
        void qc.invalidateQueries({ queryKey: keys.db(db) });
        onClose();
      } else {
        setError(new ApiError(body as ApiErrorBody, xhr.status));
      }
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      setProgress(null);
      setError(new Error('Network error during upload. Nothing was imported.'));
    };
    xhr.onabort = () => {
      xhrRef.current = null;
      setProgress(null);
      toast.info('Import cancelled. Nothing was imported.');
    };
    xhr.send(file);
  };

  const cancel = () => (uploading ? xhrRef.current?.abort() : onClose());

  const pct = progress ? Math.min(progress.loaded / Math.max(progress.total, 1), 1) : 0;
  const elapsed = progress ? (performance.now() - progress.startedAt) / 1000 : 0;
  const speed = progress && elapsed > 0.5 ? progress.loaded / elapsed : 0;
  const eta = speed > 0 && progress ? (progress.total - progress.loaded) / speed : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !uploading && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl" onInteractOutside={(e) => uploading && e.preventDefault()}>
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Import data</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            into {meta.schema}.{meta.table}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".csv,.tsv,.tab,.txt,.ndjson,.jsonl,.json,.gz"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />

          {!file ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pickFile(e.dataTransfer.files[0]);
              }}
              className={cn(
                'flex w-full flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center transition-colors hover:bg-muted/40',
                dragging && 'border-foreground bg-muted/60',
              )}
            >
              <FileUp className="size-8 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">Drop a file here, or click to browse</div>
                <div className="mt-1 text-xs text-muted-foreground">CSV, TSV or JSON Lines, optionally gzipped (.gz). Any size: it streams straight into Postgres.</div>
              </div>
            </button>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
                <FileUp className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" title={file.name}>
                    {file.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatBytes(file.size)}
                    {gzip && ' · gzip'}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
                  <RefreshCw /> Change
                </Button>
              </div>

              {/* Options */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Format</Label>
                  <Select value={format} onValueChange={(v) => setFormat(v as ImportFormat)} disabled={uploading}>
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IMPORT_FORMATS.map((f) => (
                        <SelectItem key={f} value={f}>
                          {FORMAT_LABEL[f]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {format === 'csv' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Delimiter</Label>
                    <Select value={delimiter} onValueChange={setDelimiter} disabled={uploading}>
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DELIMITERS.map((d) => (
                          <SelectItem key={d.value} value={d.value}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 sm:col-span-2">
                  {format !== 'ndjson' && (
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox checked={header} onCheckedChange={(v) => setHeader(v === true)} disabled={uploading} />
                      First row is a header
                    </label>
                  )}
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={gzip} onCheckedChange={(v) => setGzip(v === true)} disabled={uploading} />
                    Gzip-compressed
                  </label>
                </div>
              </div>

              {/* Mode */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Mode</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { on: false, title: 'Append', text: 'Add the rows to what is already in the table.' },
                    { on: true, title: 'Replace', text: 'Empty the table first (TRUNCATE), then import.' },
                  ].map((m) => (
                    <button
                      key={m.title}
                      type="button"
                      disabled={uploading}
                      onClick={() => setTruncate(m.on)}
                      className={cn(
                        'rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/40',
                        truncate === m.on && (m.on ? 'border-destructive bg-destructive/5' : 'border-foreground'),
                      )}
                    >
                      <div className={cn('text-sm font-medium', m.on && truncate && 'text-destructive')}>{m.title}</div>
                      <div className="text-xs text-muted-foreground">{m.text}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Mapping */}
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <Label className="text-xs text-muted-foreground">Columns</Label>
                  <span className="text-[11px] text-muted-foreground">Preview of the first rows</span>
                </div>
                {readError && <ErrorAlert error={new Error(readError)} />}
                {!preview && !readError && (
                  <div className="flex justify-center p-6">
                    <Spinner />
                  </div>
                )}
                {preview && (
                  <div className="divide-y overflow-hidden rounded-lg border">
                    {preview.columns.map((col, i) => (
                      <div key={`${col}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,14rem)] items-center gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-[13px]" title={col}>
                            {col}
                          </div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {preview.rows
                              .slice(0, 3)
                              .map((r) => r[i] ?? 'NULL')
                              .join(' · ') || '—'}
                          </div>
                        </div>
                        <ArrowRight className="size-3.5 text-muted-foreground" />
                        <Combobox
                          value={mapping[i] || undefined}
                          onChange={(v) => setMapping((m) => m.map((x, k) => (k === i ? v : x)))}
                          options={[
                            ...(format === 'ndjson' ? [{ value: SKIP, label: '— skip —' }] : []),
                            ...meta.columns.filter((c) => !c.generated).map((c) => ({ value: c.name, hint: c.typeName })),
                          ]}
                          placeholder="Choose column…"
                          searchPlaceholder="Search columns…"
                          mono
                          disabled={uploading}
                          className={cn('w-full', !mapping[i] && 'border-warning/60')}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {error !== null && <ErrorAlert error={error} title="Import failed. Nothing was imported." />}
        </div>

        <DialogFooter className="flex-col items-stretch gap-3 border-t px-6 py-4 sm:flex-col">
          {progress && (
            <div className="space-y-1.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-foreground transition-[width] duration-300" style={{ width: `${pct * 100}%` }} />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>
                  {pct >= 1 ? 'Upload complete. Waiting for Postgres to finish…' : `${formatBytes(progress.loaded)} of ${formatBytes(progress.total)}`}
                </span>
                <span>
                  {speed > 0 && pct < 1 && `${formatBytes(speed)}/s`}
                  {eta !== null && pct < 1 && ` · ${eta < 60 ? `${Math.ceil(eta)}s` : formatDuration(eta)} left`}
                </span>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className={cn('text-xs', problem && file ? 'text-warning' : 'text-muted-foreground')}>
              {file && problem ? problem : 'Runs in one transaction: if any row fails, nothing is imported.'}
            </p>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={cancel}>
                {uploading ? (
                  <>
                    <X /> Cancel upload
                  </>
                ) : (
                  'Cancel'
                )}
              </Button>
              <Button onClick={start} disabled={!file || !!problem || uploading} variant={truncate ? 'destructive' : 'default'}>
                {uploading ? <Spinner className="text-current" /> : <Upload />}
                {truncate ? 'Replace data' : 'Import'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
