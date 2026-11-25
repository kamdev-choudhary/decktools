import { Database, Download, FileArchive, FileCode2, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EXPORT_FORMATS, EXPORT_META, type ExportFormat } from '@shared/export';
import { BASE } from '@/api/client';
import { useStats } from '@/api/hooks';
import { CenteredSpinner, ErrorAlert } from '@/components/app/feedback';
import { TruncatedText } from '@deck/ui/components/truncated-text';
import { Badge } from '@deck/ui/components/badge';
import { Button } from '@deck/ui/components/button';
import { Checkbox } from '@deck/ui/components/checkbox';
import { Input } from '@deck/ui/components/input';
import { Label } from '@deck/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deck/ui/components/select';
import { formatBytes, formatCompact } from '@/lib/format';
import { cn } from '@deck/ui/lib/utils';

type Contents = 'both' | 'structure' | 'data';
type Format = 'sql' | 'zip';

const CONTENTS: { value: Contents; title: string; text: string }[] = [
  { value: 'both', title: 'Structure + data', text: 'A full backup you can restore anywhere.' },
  { value: 'structure', title: 'Structure only', text: 'CREATE statements, indexes, constraints. No rows.' },
  { value: 'data', title: 'Data only', text: 'Rows only, for tables that already exist.' },
];

function OptionCard({
  active,
  onClick,
  title,
  text,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  text: string;
  icon?: typeof Database;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/40',
        active && 'border-foreground',
      )}
    >
      {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{text}</span>
      </span>
    </button>
  );
}

export function ExportView({ db }: { db: string }) {
  const stats = useStats(db);
  const tables = useMemo(
    () => (stats.data?.tables ?? []).filter((t) => t.kind === 'r' || t.kind === 'p'),
    [stats.data],
  );
  const [selected, setSelected] = useState<Set<string> | null>(null); // null = everything
  const [filter, setFilter] = useState('');
  const [contents, setContents] = useState<Contents>('both');
  const [format, setFormat] = useState<Format>('sql');
  const [gzip, setGzip] = useState(true);
  const [dataFormat, setDataFormat] = useState<ExportFormat>('csv');

  const id = (t: { schema: string; name: string }) => `${t.schema}.${t.name}`;
  const isSelected = (t: { schema: string; name: string }) => selected === null || selected.has(id(t));
  const chosen = tables.filter(isSelected);
  const whole = selected === null || chosen.length === tables.length;
  const shown = tables.filter((t) => id(t).toLowerCase().includes(filter.trim().toLowerCase()));

  const toggle = (t: { schema: string; name: string }) =>
    setSelected((cur) => {
      const next = new Set(cur ?? tables.map(id));
      if (next.has(id(t))) next.delete(id(t));
      else next.add(id(t));
      return next.size === tables.length ? null : next;
    });
  const allShownSelected = shown.length > 0 && shown.every(isSelected);
  const toggleShown = () =>
    setSelected((cur) => {
      const next = new Set(cur ?? tables.map(id));
      for (const t of shown) {
        if (allShownSelected) next.delete(id(t));
        else next.add(id(t));
      }
      return next.size === tables.length ? null : next;
    });

  const rows = chosen.reduce((s, t) => s + t.rows, 0);
  const bytes = chosen.reduce((s, t) => s + t.tableBytes, 0);

  const download = () => {
    const params = new URLSearchParams({
      structure: contents !== 'data' ? '1' : '0',
      data: contents !== 'structure' ? '1' : '0',
      format,
      gzip: format === 'sql' && gzip ? '1' : '0',
      dataFormat,
      tables: whole ? '[]' : JSON.stringify(chosen.map((t) => ({ schema: t.schema, table: t.name }))),
    });
    const a = Object.assign(document.createElement('a'), {
      href: `${BASE}api/db/${encodeURIComponent(db)}/dump?${params}`,
    });
    document.body.append(a);
    a.click();
    a.remove();
    toast.info('Export started', {
      description: 'It streams straight to your downloads; your browser shows the progress.',
    });
  };

  if (stats.isPending) return <CenteredSpinner label="Loading tables…" />;
  if (stats.isError) return <ErrorAlert error={stats.error} className="m-6 w-auto" />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-6 px-4 py-6 md:px-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Export data</h1>
            <p className="text-sm text-muted-foreground">
              Back up the whole database, or pick tables. Exports stream directly to your computer, so size doesn't
              matter.
            </p>
          </div>

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            {/* Tables */}
            <section className="min-w-0 overflow-hidden rounded-lg border">
              <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={allShownSelected ? true : shown.some(isSelected) ? 'indeterminate' : false}
                    onCheckedChange={toggleShown}
                  />
                  {filter ? 'All matching' : 'All tables'}
                </label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {chosen.length} of {tables.length} selected
                </span>
                <div className="relative ml-auto w-full sm:w-64">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter tables…"
                    className="h-8 pl-8 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-[auto_minmax(0,1fr)_6rem_6rem] items-center gap-x-4 border-b bg-grid-header px-4 py-2 text-xs text-muted-foreground">
                <span className="w-4" />
                <span>Table</span>
                <span className="text-right">Rows</span>
                <span className="text-right">Size</span>
              </div>
              <ul className="max-h-[60vh] divide-y overflow-y-auto">
                {shown.map((t) => (
                  <li key={id(t)}>
                    <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_6rem_6rem] items-center gap-x-4 px-4 py-2 text-sm hover:bg-muted/40">
                      <Checkbox checked={isSelected(t)} onCheckedChange={() => toggle(t)} />
                      <span className="flex min-w-0 items-center gap-2">
                        <TruncatedText text={t.name} tooltip={id(t)} className="font-mono text-[13px]" />
                        {t.schema !== 'public' && (
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            {t.schema}
                          </Badge>
                        )}
                      </span>
                      <span className="text-right text-muted-foreground tabular-nums">{formatCompact(t.rows)}</span>
                      <span className="text-right text-muted-foreground tabular-nums">{formatBytes(t.tableBytes)}</span>
                    </label>
                  </li>
                ))}
                {!shown.length && <li className="p-8 text-center text-sm text-muted-foreground">No tables match.</li>}
              </ul>
            </section>

            {/* Options */}
            <aside className="space-y-5 rounded-lg border p-4 xl:sticky xl:top-0">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Include</Label>
                <div className="space-y-2">
                  {CONTENTS.map((c) => (
                    <OptionCard
                      key={c.value}
                      active={contents === c.value}
                      onClick={() => setContents(c.value)}
                      title={c.title}
                      text={c.text}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Format</Label>
                <OptionCard
                  active={format === 'sql'}
                  onClick={() => setFormat('sql')}
                  icon={FileCode2}
                  title="SQL backup (.sql)"
                  text="One file. Restore with psql, or drop it on pgdeck's Import page."
                />
                <OptionCard
                  active={format === 'zip'}
                  onClick={() => setFormat('zip')}
                  icon={FileArchive}
                  title="ZIP of files"
                  text="schema.sql plus one data file per table."
                />
                {format === 'sql' && (
                  <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm">
                    <Checkbox checked={gzip} onCheckedChange={(v) => setGzip(v === true)} />
                    Compress (.sql.gz)
                  </label>
                )}
                {format === 'zip' && contents !== 'structure' && (
                  <div className="space-y-1.5 pt-1">
                    <Label className="text-xs text-muted-foreground">Data files as</Label>
                    <Select value={dataFormat} onValueChange={(v) => setDataFormat(v as ExportFormat)}>
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPORT_FORMATS.map((f) => (
                          <SelectItem key={f} value={f}>
                            {EXPORT_META[f].label} (.{EXPORT_META[f].ext})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Database className="size-3.5" />
                  {whole ? `Whole database: ${db}` : `${chosen.length} of ${tables.length} tables`}
                </div>
                <div className="tabular-nums">
                  ~{formatCompact(rows)} rows · {formatBytes(bytes)} of table data
                </div>
                {whole && contents !== 'data' && (
                  <div>Includes schemas, extensions, types, sequences, functions, views and triggers.</div>
                )}
                {!whole && contents !== 'data' && (
                  <div>Views, functions and extensions are only included for the whole database.</div>
                )}
                <div>All tables are read from one consistent snapshot.</div>
              </div>

              <Button className="w-full" onClick={download} disabled={!chosen.length}>
                <Download /> Download {format === 'zip' ? '.zip' : gzip ? '.sql.gz' : '.sql'}
              </Button>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
