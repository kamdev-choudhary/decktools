import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IMPORT_FORMATS, type ImportFormat } from '@shared/export';
import type { TableMeta } from '@shared/types';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { autoMap, buildPreview, detectFormat, readHead, sniffDelimiter, type FilePreview } from '@/lib/file-preview';
import { cn } from '@/lib/utils';
import { Combobox } from '../Combobox';
import { ErrorAlert, Spinner } from '../feedback';

const FORMAT_LABEL: Record<ImportFormat, string> = { csv: 'CSV', tsv: 'TSV (Postgres text)', ndjson: 'JSON Lines' };
const DELIMITERS = [
  { value: ',', label: 'Comma  ,' },
  { value: ';', label: 'Semicolon  ;' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe  |' },
];
const SKIP = '__skip__';

/** Everything needed to send a file to /import, or why it can't be sent yet. */
export interface ImportPlan {
  params: URLSearchParams;
  truncate: boolean;
  /** Number of mapped columns, for display. */
  columns: number;
}

interface ImportSettingsProps {
  file: File;
  meta: TableMeta;
  disabled: boolean;
  onPlan: (plan: ImportPlan | null, problem: string | null) => void;
}

/**
 * Per-file import options (format, delimiter, header, gzip, append/replace)
 * and the column mapping, built from a preview of the start of the file.
 */
export function ImportSettings({ file, meta, disabled, onPlan }: ImportSettingsProps) {
  const detected = detectFormat(file.name);
  const [format, setFormat] = useState<ImportFormat>(detected.format);
  const [gzip, setGzip] = useState(detected.gzip);
  const [delimiter, setDelimiter] = useState(',');
  const [header, setHeader] = useState(detected.format !== 'ndjson');
  const [truncate, setTruncate] = useState(false);
  const [head, setHead] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [readError, setReadError] = useState<string | null>(null);

  const insertable = meta.columns.filter((c) => !c.generated);

  // Read the first few KB whenever compression changes.
  useEffect(() => {
    let cancelled = false;
    setHead(null);
    setReadError(null);
    readHead(file, gzip)
      .then((text) => {
        if (cancelled) return;
        setHead(text);
        setDelimiter(sniffDelimiter(text));
      })
      .catch((e: Error) => !cancelled && setReadError(gzip ? `Couldn't decompress the file: ${e.message}` : e.message));
    return () => {
      cancelled = true;
    };
  }, [file, gzip]);

  // Re-parse the preview and re-derive the mapping when parsing options change.
  useEffect(() => {
    if (head === null) return;
    const p = buildPreview(head, format, delimiter, header);
    setPreview(p);
    setMapping(
      autoMap(
        p.columns,
        insertable.map((c) => c.name),
        format !== 'ndjson',
      ).map((m) => (m === '' && format === 'ndjson' ? SKIP : m)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [head, format, delimiter, header, meta]);

  const mapped = mapping.map((m, i) => ({ fileColumn: preview?.columns[i] ?? '', target: m })).filter((m) => m.target && m.target !== SKIP);
  const duplicate = mapped.find((m, i) => mapped.findIndex((x) => x.target === m.target) !== i);
  const unmappedCsv = format !== 'ndjson' && mapping.some((m) => !m || m === SKIP);
  const problem = readError
    ? 'The file could not be read.'
    : !preview
      ? 'Reading file…'
      : !preview.columns.length
        ? 'No columns found in the file.'
        : !mapped.length
          ? 'Map at least one column.'
          : duplicate
            ? `"${duplicate.target}" is mapped more than once.`
            : unmappedCsv
              ? 'Every file column needs a target column (COPY reads them all).'
              : null;

  // Report the plan upward whenever it changes.
  const planKey = JSON.stringify({ format, gzip, delimiter, header, truncate, mapped, problem });
  useEffect(() => {
    if (problem) return onPlan(null, problem);
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
    onPlan({ params, truncate, columns: mapped.length }, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, meta.schema, meta.table]);

  return (
    <div className="space-y-5">
      {/* Options */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Format</Label>
          <Select value={format} onValueChange={(v) => setFormat(v as ImportFormat)} disabled={disabled}>
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
            <Select value={delimiter} onValueChange={setDelimiter} disabled={disabled}>
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
              <Checkbox checked={header} onCheckedChange={(v) => setHeader(v === true)} disabled={disabled} />
              First row is a header
            </label>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={gzip} onCheckedChange={(v) => setGzip(v === true)} disabled={disabled} />
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
              disabled={disabled}
              onClick={() => setTruncate(m.on)}
              className={cn(
                'rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/40 disabled:opacity-60',
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
                    ...insertable.map((c) => ({ value: c.name, hint: c.typeName })),
                  ]}
                  placeholder="Choose column…"
                  searchPlaceholder="Search columns…"
                  mono
                  disabled={disabled}
                  className={cn('w-full', !mapping[i] && 'border-warning/60')}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
