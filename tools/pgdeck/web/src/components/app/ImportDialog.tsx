import { useQueryClient } from '@tanstack/react-query';
import { FileUp, RefreshCw, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { TableMeta } from '@shared/types';
import { keys } from '@/api/hooks';
import { Button } from '@deck/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@deck/ui/components/dialog';
import { formatBytes, formatNumber } from '@/lib/format';
import { uploadImport, UploadCancelled } from '@/lib/import-upload';
import { cn } from '@deck/ui/lib/utils';
import { ErrorAlert, Spinner } from './feedback';
import { ImportSettings, type ImportPlan } from './import/ImportSettings';
import { UploadProgress, type Progress } from './import/UploadProgress';

interface ImportDialogProps {
  db: string;
  meta: TableMeta;
  onClose: () => void;
}

/** Import one file into the table you're looking at. */
export function ImportDialog({ db, meta, onClose }: ImportDialogProps) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<unknown>(null);
  const uploading = progress !== null;

  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPlan(null);
    setError(null);
  };

  const start = async () => {
    if (!file || !plan) return;
    const startedAt = performance.now();
    setProgress({ loaded: 0, total: file.size, startedAt, at: startedAt });
    setError(null);
    const job = uploadImport(db, file, plan.params, (loaded, total) => setProgress({ loaded, total, startedAt, at: performance.now() }));
    abortRef.current = job.abort;
    try {
      const r = await job.promise;
      toast.success(`Imported ${formatNumber(r.rowCount)} rows into ${meta.table}`, {
        description: `${formatBytes(r.bytes)} in ${(r.ms / 1000).toFixed(1)}s`,
      });
      void qc.invalidateQueries({ queryKey: keys.db(db) });
      onClose();
    } catch (e) {
      if (e instanceof UploadCancelled) toast.info(e.message);
      else setError(e);
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !uploading && onClose()}>
      <DialogContent
        className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        onInteractOutside={(e) => uploading && e.preventDefault()}
      >
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
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = '';
            }}
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
                pick(e.dataTransfer.files[0]);
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
                  <div className="text-xs text-muted-foreground">{formatBytes(file.size)}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
                  <RefreshCw /> Change
                </Button>
              </div>
              <ImportSettings
                key={`${file.name}-${file.size}-${file.lastModified}`}
                file={file}
                meta={meta}
                disabled={uploading}
                onPlan={(p, why) => {
                  setPlan(p);
                  setProblem(why);
                }}
              />
            </>
          )}
          {error !== null && <ErrorAlert error={error} title="Import failed. Nothing was imported." />}
        </div>

        <DialogFooter className="flex-col items-stretch gap-3 border-t px-6 py-4 sm:flex-col">
          {progress && <UploadProgress progress={progress} />}
          <div className="flex items-center justify-between gap-3">
            <p className={cn('text-xs', file && problem ? 'text-warning' : 'text-muted-foreground')}>
              {file && problem ? problem : 'Runs in one transaction: if any row fails, nothing is imported.'}
            </p>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={() => (uploading ? abortRef.current?.() : onClose())}>
                {uploading ? (
                  <>
                    <X /> Cancel upload
                  </>
                ) : (
                  'Cancel'
                )}
              </Button>
              <Button onClick={() => void start()} disabled={!file || !plan || uploading} variant={plan?.truncate ? 'destructive' : 'default'}>
                {uploading ? <Spinner className="text-current" /> : <Upload />}
                {plan?.truncate ? 'Replace data' : 'Import'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
