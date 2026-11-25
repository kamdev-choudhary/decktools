import type { CompareItem, CompareResult, JobInfo } from '@shared/types';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CircleAlert, FolderSync, GitCompareArrows, Square } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { errorText } from '@/api/client';
import { qk, syncApi, useBucketsFor, useJobs } from '@/api/hooks';
import { useApp } from '@/components/app/app-context';
import { ErrorAlert } from '@/components/app/bucket-dialogs';
import { EmptyState } from '@/components/app/empty-state';
import { FormField } from '@/components/app/form-field';
import { PageHeader } from '@/components/app/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatBytes, formatNumber, formatRelative } from '@/lib/format';

interface Loc {
  connectionId: string;
  bucket: string;
  prefix: string;
}

function LocationPicker({ title, value, onChange }: { title: string; value: Loc; onChange: (v: Loc) => void }) {
  const { connections } = useApp();
  const buckets = useBucketsFor(value.connectionId || null);
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-5">
        <FieldGroup className="gap-3">
          <FormField label="Connection" htmlFor={`${title}-conn`}>
            <Select value={value.connectionId} onValueChange={(v) => onChange({ connectionId: v, bucket: '', prefix: '' })}>
              <SelectTrigger id={`${title}-conn`} className="w-full">
                <SelectValue placeholder="Choose a connection" />
              </SelectTrigger>
              <SelectContent>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField
            label="Bucket"
            htmlFor={`${title}-bucket`}
            error={buckets.isError ? errorText(buckets.error) : undefined}
          >
            <Select value={value.bucket} onValueChange={(v) => onChange({ ...value, bucket: v })} disabled={!value.connectionId || buckets.isPending}>
              <SelectTrigger id={`${title}-bucket`} className="w-full">
                <SelectValue placeholder={buckets.isPending && value.connectionId ? 'Loading…' : 'Choose a bucket'} />
              </SelectTrigger>
              <SelectContent>
                {buckets.data?.buckets.map((b) => (
                  <SelectItem key={b.name} value={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Folder" htmlFor={`${title}-prefix`} description="Empty for the whole bucket">
            <Input
              id={`${title}-prefix`}
              value={value.prefix}
              onChange={(e) => onChange({ ...value, prefix: e.target.value.replace(/^\/+/, '') })}
              placeholder="path/to/folder/"
              className="font-mono text-xs"
            />
          </FormField>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

const STATUS_LABEL: Record<CompareItem['status'], string> = {
  missing: 'Only in source',
  changed: 'Different',
  extra: 'Only in target',
  same: 'Same',
};

function JobRow({ job }: { job: JobInfo }) {
  const qc = useQueryClient();
  const pct = job.total ? (job.done / job.total) * 100 : job.status === 'done' ? 100 : 0;
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={job.title}>
          {job.title}
        </p>
        <Badge variant={job.status === 'failed' ? 'destructive' : job.status === 'running' ? 'secondary' : 'outline'} className="capitalize">
          {job.status === 'running' && <Spinner className="size-3" />} {job.status}
        </Badge>
        {job.status === 'running' && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              syncApi
                .cancel(job.id)
                .then(() => qc.invalidateQueries({ queryKey: qk.jobs }))
                .catch((e: unknown) => toast.error(errorText(e)))
            }
          >
            <Square /> Stop
          </Button>
        )}
      </div>
      <Progress value={pct} className="h-1.5" />
      <p className="text-xs text-muted-foreground">
        {formatNumber(job.done)} / {formatNumber(job.total)} objects · {formatBytes(job.bytesDone)} of {formatBytes(job.bytesTotal)} · started{' '}
        {formatRelative(job.startedAt)}
        {job.errors.length > 0 && <span className="text-destructive"> · {job.errors.length} errors</span>}
      </p>
      {job.errors.length > 0 && (
        <ul className="max-h-24 overflow-y-auto rounded-md bg-destructive/5 px-3 py-2 font-mono text-[11px] text-destructive">
          {job.errors.slice(0, 20).map((e, i) => (
            <li key={i} className="truncate">
              {e.key ? `${e.key}: ` : ''}
              {e.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SyncView() {
  const { connection, readonly } = useApp();
  const qc = useQueryClient();
  const jobs = useJobs();
  const [source, setSource] = useState<Loc>({ connectionId: connection.id, bucket: '', prefix: '' });
  const [target, setTarget] = useState<Loc>({ connectionId: connection.id, bucket: '', prefix: '' });
  const [mode, setMode] = useState<'copy' | 'mirror'>('copy');
  const [result, setResult] = useState<CompareResult | null>(null);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmMirror, setConfirmMirror] = useState(false);
  const [filter, setFilter] = useState<CompareItem['status'] | 'all-changes'>('all-changes');

  const ready = source.connectionId && source.bucket && target.connectionId && target.bucket;
  const sameSpot =
    !!ready && source.connectionId === target.connectionId && source.bucket === target.bucket && source.prefix === target.prefix;

  const compare = async () => {
    setComparing(true);
    setError(null);
    setResult(null);
    try {
      setResult(await syncApi.compare({ source, target }));
    } catch (e) {
      setError(e);
    } finally {
      setComparing(false);
    }
  };

  const start = async () => {
    try {
      await syncApi.start({ source, target, mode });
      toast.success('Sync started', { description: 'Progress is shown below. You can leave this page.' });
      setResult(null);
      void qc.invalidateQueries({ queryKey: qk.jobs });
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const shown = useMemo(
    () => (result?.items ?? []).filter((i) => (filter === 'all-changes' ? i.status !== 'same' : i.status === filter)).slice(0, 500),
    [result, filter],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageHeader
        icon={<FolderSync />}
        title="Sync"
        description="Compare two folders on any connections, then copy or mirror one onto the other."
      />
      <div className="space-y-6 p-6">
        <div className="grid items-center gap-4 lg:grid-cols-[1fr_auto_1fr]">
          <LocationPicker title="Source" value={source} onChange={(v) => (setSource(v), setResult(null))} />
          <ArrowRight className="mx-auto size-5 rotate-90 text-muted-foreground lg:rotate-0" />
          <LocationPicker title="Target" value={target} onChange={(v) => (setTarget(v), setResult(null))} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void compare()} disabled={!ready || sameSpot || comparing}>
            {comparing ? <Spinner /> : <GitCompareArrows />}
            Compare
          </Button>
          {sameSpot && <span className="text-sm text-muted-foreground">Source and target are the same folder.</span>}
          {source.connectionId !== target.connectionId && ready && (
            <span className="text-sm text-muted-foreground">Different connections: data streams through s3deck.</span>
          )}
        </div>

        {error != null && <ErrorAlert error={error} />}

        {result && (
          <div className="space-y-4">
            {result.truncated && (
              <Alert>
                <CircleAlert />
                <AlertDescription>One side has more than 200,000 objects; only the first 200,000 were compared.</AlertDescription>
              </Alert>
            )}
            <dl className="grid divide-y rounded-lg border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
              {(['missing', 'changed', 'extra', 'same'] as const).map((k) => (
                <div key={k} className="px-4 py-3">
                  <dt className="text-xs text-muted-foreground">{STATUS_LABEL[k]}</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">{formatNumber(result.counts[k])}</dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
              <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && setMode(v as typeof mode)}>
                <ToggleGroupItem value="copy">Copy new and changed</ToggleGroupItem>
                <ToggleGroupItem value="mirror">Mirror (also delete extras)</ToggleGroupItem>
              </ToggleGroup>
              <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                {formatNumber(result.counts.missing + result.counts.changed)} objects ({formatBytes(result.bytesToCopy)}) to copy
                {mode === 'mirror' && result.counts.extra > 0 && `, ${formatNumber(result.counts.extra)} to delete from the target`}.
              </p>
              <Button
                disabled={readonly || (result.counts.missing + result.counts.changed + (mode === 'mirror' ? result.counts.extra : 0) === 0)}
                variant={mode === 'mirror' && result.counts.extra > 0 ? 'destructive' : 'default'}
                onClick={() => (mode === 'mirror' && result.counts.extra > 0 ? setConfirmMirror(true) : void start())}
              >
                <FolderSync /> Start sync
              </Button>
            </div>

            <div className="overflow-hidden rounded-lg border">
              <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
                <ToggleGroup type="single" size="sm" value={filter} onValueChange={(v) => v && setFilter(v as typeof filter)}>
                  <ToggleGroupItem value="all-changes">Changes</ToggleGroupItem>
                  <ToggleGroupItem value="missing">Only in source</ToggleGroupItem>
                  <ToggleGroupItem value="changed">Different</ToggleGroupItem>
                  <ToggleGroupItem value="extra">Only in target</ToggleGroupItem>
                  <ToggleGroupItem value="same">Same</ToggleGroupItem>
                </ToggleGroup>
              </div>
              {shown.length === 0 ? (
                <EmptyState icon={<GitCompareArrows />} title="Nothing here">
                  {filter === 'all-changes' ? 'Source and target already match.' : 'No objects in this group.'}
                </EmptyState>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-4">Key (relative)</TableHead>
                      <TableHead className="w-36">Status</TableHead>
                      <TableHead className="w-28 text-right">Source</TableHead>
                      <TableHead className="w-28 pr-4 text-right">Target</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((i) => (
                      <TableRow key={i.key}>
                        <TableCell className="max-w-0 truncate pl-4 font-mono text-xs" title={i.key}>
                          {i.key}
                        </TableCell>
                        <TableCell>
                          <Badge variant={i.status === 'extra' ? 'destructive' : i.status === 'same' ? 'outline' : 'secondary'}>{STATUS_LABEL[i.status]}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{i.sourceSize !== null ? formatBytes(i.sourceSize) : '—'}</TableCell>
                        <TableCell className="pr-4 text-right tabular-nums">{i.targetSize !== null ? formatBytes(i.targetSize) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        )}

        <section>
          <h2 className="mb-2 text-sm font-semibold">Jobs</h2>
          <div className="divide-y rounded-lg border">
            {jobs.data?.jobs.length ? (
              jobs.data.jobs.map((j) => <JobRow key={j.id} job={j} />)
            ) : (
              <p className="px-4 py-3 text-sm text-muted-foreground">No sync jobs yet. Jobs run on the server and stop if s3deck restarts.</p>
            )}
          </div>
        </section>
      </div>

      <AlertDialog open={confirmMirror} onOpenChange={setConfirmMirror}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mirror and delete {result ? formatNumber(result.counts.extra) : 0} objects?</AlertDialogTitle>
            <AlertDialogDescription>
              Objects that exist only in the target ({target.bucket}/{target.prefix}) will be deleted so it matches the source.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void start()}>
              Mirror
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
