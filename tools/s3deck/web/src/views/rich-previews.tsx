/**
 * Previews that need a parser (spreadsheets, Word, Parquet, ZIP) or special handling
 * (SVG, HTML, fonts). Loaded lazily so these libraries stay out of the main bundle.
 *
 * Safety: the download route serves anything that isn't a plain image/media/PDF as
 * text/plain with a sandbox CSP, so nothing here asks the browser to render an object
 * from s3deck's origin. SVG is shown through an <img> (which never runs script), HTML
 * in an iframe with an empty sandbox, and Word output is sanitized with DOMPurify.
 */
import { PREVIEW_TEXT_BYTES } from '@shared/constants';
import DOMPurify from 'dompurify';
import { Code, Eye } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { readError } from '@/api/client';
import { EmptyState } from '@/components/app/empty-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatBytes, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { readZipListing } from '@/lib/zip-listing';

/** Files fully downloaded for parsing (xlsx, docx) are capped at this size. */
const MAX_PARSE_BYTES = 30 * 1024 * 1024;
const MAX_TABLE_ROWS = 500;

export type RichKind = 'svg' | 'html' | 'font' | 'spreadsheet' | 'docx' | 'parquet' | 'zip';

export interface RichPreviewProps {
  kind: RichKind;
  url: string;
  name: string;
  size: number;
}

export default function RichPreview(props: RichPreviewProps) {
  switch (props.kind) {
    case 'svg':
      return <SvgPreview {...props} />;
    case 'html':
      return <HtmlPreview {...props} />;
    case 'font':
      return <FontPreview {...props} />;
    case 'spreadsheet':
      return <SpreadsheetPreview {...props} />;
    case 'docx':
      return <DocxPreview {...props} />;
    case 'parquet':
      return <ParquetPreview {...props} />;
    case 'zip':
      return <ZipPreview {...props} />;
  }
}

/* ------------------------------------------------------------------ */
/* Fetch helpers                                                       */
/* ------------------------------------------------------------------ */

async function fetchBytes(
  url: string,
  signal: AbortSignal,
  range?: [number, number],
): Promise<Uint8Array<ArrayBuffer>> {
  const headers: HeadersInit = range ? { Range: `bytes=${range[0]}-${range[1]}` } : {};
  const res = await fetch(url, { headers, signal, credentials: 'same-origin' });
  if (!res.ok) throw await readError(res);
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchText(url: string, signal: AbortSignal) {
  const bytes = await fetchBytes(url, signal, [0, PREVIEW_TEXT_BYTES - 1]);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function useFile<T>(key: string, url: string, load: (signal: AbortSignal) => Promise<T>) {
  return useQuery({
    queryKey: ['rich-preview', key, url],
    queryFn: ({ signal }) => load(signal),
    staleTime: 30_000,
    retry: false,
  });
}

function Loading() {
  return (
    <div className="grid h-full place-items-center">
      <Spinner />
    </div>
  );
}

function Failed({ error }: { error: unknown }) {
  return (
    <EmptyState title="Couldn’t preview this file">{error instanceof Error ? error.message : String(error)}</EmptyState>
  );
}

function TooLarge({ size }: { size: number }) {
  return (
    <EmptyState title="Too large to preview">
      This file is {formatBytes(size)}. Files up to {formatBytes(MAX_PARSE_BYTES)} are previewed; download it to open
      it.
    </EmptyState>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <Alert className="rounded-none border-x-0 border-t-0 py-2">
      <AlertDescription className="text-xs">{children}</AlertDescription>
    </Alert>
  );
}

function RenderSourceToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex justify-end border-b px-3 py-1.5">
      <ToggleGroup type="single" size="sm" variant="outline" value={value} onValueChange={(v) => v && onChange(v)}>
        <ToggleGroupItem value="rendered" aria-label="Rendered">
          <Eye /> Rendered
        </ToggleGroupItem>
        <ToggleGroupItem value="source" aria-label="Source">
          <Code /> Source
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

function SourceView({ text }: { text: string }) {
  return (
    <pre className="min-h-full overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
      {text}
    </pre>
  );
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().replace('T00:00:00.000Z', '');
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function DataTable({ head, rows }: { head: string[]; rows: unknown[][] }) {
  return (
    <Table className="text-xs">
      <TableHeader className="sticky top-0 z-10 bg-muted">
        <TableRow>
          {head.map((h, i) => (
            <TableHead key={i} className="whitespace-nowrap">
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            {head.map((_, j) => {
              const t = cellText(r[j]);
              return (
                <TableCell key={j} className="max-w-xs truncate" title={t}>
                  {t}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/* ------------------------------------------------------------------ */
/* SVG and HTML                                                        */
/* ------------------------------------------------------------------ */

function SvgPreview({ url }: RichPreviewProps) {
  const q = useFile('text', url, (s) => fetchText(url, s));
  const [mode, setMode] = useState('rendered');
  const blobUrl = useMemo(
    () => (q.data ? URL.createObjectURL(new Blob([q.data], { type: 'image/svg+xml' })) : null),
    [q.data],
  );
  useEffect(() => () => void (blobUrl && URL.revokeObjectURL(blobUrl)), [blobUrl]);

  if (q.isPending) return <Loading />;
  if (q.isError) return <Failed error={q.error} />;
  return (
    <div className="flex h-full flex-col">
      <RenderSourceToggle value={mode} onChange={setMode} />
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === 'source' ? (
          <SourceView text={q.data} />
        ) : (
          <div className="grid h-full place-items-center p-6">
            {/* An <img> never runs scripts inside the SVG. */}
            <img
              src={blobUrl ?? undefined}
              alt=""
              className="max-h-full max-w-full rounded border bg-[conic-gradient(#8881_25%,transparent_0_50%,#8881_0_75%,transparent_0)] bg-[length:16px_16px] object-contain"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function HtmlPreview({ url, name }: RichPreviewProps) {
  const q = useFile('text', url, (s) => fetchText(url, s));
  const [mode, setMode] = useState('rendered');
  if (q.isPending) return <Loading />;
  if (q.isError) return <Failed error={q.error} />;
  return (
    <div className="flex h-full flex-col">
      <RenderSourceToggle value={mode} onChange={setMode} />
      {mode === 'source' ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <SourceView text={q.data} />
        </div>
      ) : (
        <>
          <Notice>Scripts are disabled. External images and styles may not load.</Notice>
          {/* Empty sandbox: no scripts, no forms, no navigation, unique origin. */}
          <iframe title={name} sandbox="" srcDoc={q.data} className="min-h-0 w-full flex-1 border-0 bg-white" />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fonts                                                               */
/* ------------------------------------------------------------------ */

const PANGRAM = 'The quick brown fox jumps over the lazy dog';
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n0123456789 !@#$%^&*()[]{}<>?/\\|;:\'",.-_=+~`';

function FontPreview({ url, size }: RichPreviewProps) {
  const family = `s3deck-preview-${useId().replace(/[^\w-]/g, '')}`;
  const q = useFile('font', url, async (s) => {
    if (size > MAX_PARSE_BYTES) throw new Error('Font file is too large to preview.');
    const bytes = await fetchBytes(url, s);
    const face = new FontFace(family, bytes);
    await face.load();
    document.fonts.add(face);
    return face;
  });
  useEffect(() => () => void (q.data && document.fonts.delete(q.data)), [q.data]);

  if (q.isPending) return <Loading />;
  if (q.isError) return <Failed error={q.error} />;
  return (
    <div className="space-y-6 overflow-auto p-5" style={{ fontFamily: `"${family}", sans-serif` }}>
      {[48, 32, 20, 14].map((px) => (
        <div key={px}>
          <p className="mb-1 font-sans text-xs text-muted-foreground">{px}px</p>
          <p style={{ fontSize: px, lineHeight: 1.2 }}>{PANGRAM}</p>
        </div>
      ))}
      <div>
        <p className="mb-1 font-sans text-xs text-muted-foreground">Characters</p>
        <p className="text-2xl leading-relaxed whitespace-pre-wrap break-all">{GLYPHS}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Excel (.xlsx)                                                       */
/* ------------------------------------------------------------------ */

function SpreadsheetPreview({ url, size }: RichPreviewProps) {
  const q = useFile('xlsx', url, async (s) => {
    const [{ default: readXlsxFile }, bytes] = await Promise.all([
      import('read-excel-file/browser'),
      fetchBytes(url, s),
    ]);
    return readXlsxFile(new Blob([bytes]));
  });
  const [active, setActive] = useState(0);

  if (size > MAX_PARSE_BYTES) return <TooLarge size={size} />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <Failed error={q.error} />;
  const sheets = q.data;
  const sheet = sheets[Math.min(active, sheets.length - 1)];
  if (!sheet || !sheet.data.length) return <EmptyState title="Empty workbook" />;
  const width = Math.max(...sheet.data.slice(0, MAX_TABLE_ROWS + 1).map((r) => r.length));
  const [first = [], ...rest] = sheet.data;
  const head = Array.from({ length: width }, (_, i) => cellText(first[i]) || columnName(i));

  return (
    <div className="flex h-full flex-col">
      {sheets.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b px-2 py-1.5">
          {sheets.map((s, i) => (
            <button
              key={s.sheet}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                'shrink-0 rounded-md px-2.5 py-1 text-xs',
                i === active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {s.sheet}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <DataTable head={head} rows={rest.slice(0, MAX_TABLE_ROWS)} />
        {rest.length > MAX_TABLE_ROWS && (
          <p className="p-2 text-xs text-muted-foreground">
            Showing the first {MAX_TABLE_ROWS} of {rest.length.toLocaleString()} rows.
          </p>
        )}
      </div>
    </div>
  );
}

function columnName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/* ------------------------------------------------------------------ */
/* Word (.docx)                                                        */
/* ------------------------------------------------------------------ */

function DocxPreview({ url, size }: RichPreviewProps) {
  const q = useFile('docx', url, async (s) => {
    const [mammoth, bytes] = await Promise.all([import('mammoth'), fetchBytes(url, s)]);
    const { value } = await (mammoth.default ?? mammoth).convertToHtml({ arrayBuffer: bytes.buffer });
    return DOMPurify.sanitize(value, { USE_PROFILES: { html: true } });
  });
  if (size > MAX_PARSE_BYTES) return <TooLarge size={size} />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <Failed error={q.error} />;
  return (
    <div className="flex h-full flex-col">
      <Notice>Simplified view: text, headings, lists, tables and images. Layout and fonts aren’t kept.</Notice>
      <div className="prose-md min-h-0 flex-1 overflow-auto p-5 text-sm" dangerouslySetInnerHTML={{ __html: q.data }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Parquet                                                             */
/* ------------------------------------------------------------------ */

const PARQUET_ROWS = 200;

function ParquetPreview({ url, size }: RichPreviewProps) {
  const q = useFile('parquet', url, async (signal) => {
    const { asyncBufferFromUrl, cachedAsyncBuffer, parquetMetadataAsync, parquetReadObjects, parquetSchema } =
      await import('hyparquet');
    // Range requests only: the footer, then the row groups covering the first rows.
    const file = cachedAsyncBuffer(
      await asyncBufferFromUrl({ url, byteLength: size, requestInit: { credentials: 'same-origin', signal } }),
    );
    const metadata = await parquetMetadataAsync(file);
    const columns = parquetSchema(metadata).children.map((c) => c.element.name);
    const rows = await parquetReadObjects({ file, metadata, rowStart: 0, rowEnd: PARQUET_ROWS });
    return { columns, rows, total: Number(metadata.num_rows), rowGroups: metadata.row_groups.length };
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <Failed error={q.error} />;
  const { columns, rows, total, rowGroups } = q.data;
  return (
    <div className="flex h-full flex-col">
      <Notice>
        {total.toLocaleString()} rows · {columns.length} columns · {rowGroups} row group{rowGroups === 1 ? '' : 's'}
        {total > rows.length && ` · showing the first ${rows.length}`}
      </Notice>
      <div className="min-h-0 flex-1 overflow-auto">
        <DataTable head={columns} rows={rows.map((r) => columns.map((c) => r[c]))} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ZIP: reads only the central directory with range requests          */
/* ------------------------------------------------------------------ */

const MAX_ZIP_ROWS = 2000;

function ZipPreview({ url, size }: RichPreviewProps) {
  const q = useFile('zip', url, (s) => readZipListing(size, (a, b) => fetchBytes(url, s, [a, b])));
  if (q.isPending) return <Loading />;
  if (q.isError) return <Failed error={q.error} />;
  const files = q.data.filter((e) => !e.dir);
  const total = files.reduce((n, e) => n + e.size, 0);
  const shown = files.slice(0, MAX_ZIP_ROWS);
  if (!files.length) return <EmptyState title="Empty archive" />;
  return (
    <div className="flex h-full flex-col">
      <Notice>
        {files.length.toLocaleString()} file{files.length === 1 ? '' : 's'} · {formatBytes(total)} uncompressed
        {files.length > shown.length && ` · showing the first ${shown.length.toLocaleString()}`}
      </Notice>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table className="text-xs">
          <TableHeader className="sticky top-0 z-10 bg-muted">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Size</TableHead>
              <TableHead className="text-right">Packed</TableHead>
              <TableHead>Modified</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((e, i) => (
              <TableRow key={i}>
                <TableCell className="max-w-sm truncate font-mono" title={e.name}>
                  {e.name}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">{formatBytes(e.size)}</TableCell>
                <TableCell className="text-right whitespace-nowrap text-muted-foreground tabular-nums">
                  {formatBytes(e.compressed)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {e.modified ? formatDate(e.modified.toISOString()) : ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
