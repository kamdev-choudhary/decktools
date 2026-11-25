import { Check, ChevronDown, CircleAlert, Pause, Play, RotateCw, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { formatBytes, formatDuration, formatSpeed } from '@/lib/format';
import { uploadQueue, useUploads } from '@/lib/upload-queue';
import { cn } from '@/lib/utils';
import { IconButton } from './icon-button';

export function UploadPanel() {
  const items = useUploads();
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;

  const active = items.filter((i) => i.status === 'uploading' || i.status === 'queued');
  const failed = items.filter((i) => i.status === 'error');
  const paused = items.filter((i) => i.status === 'paused');
  const total = active.reduce((a, i) => a + i.file.size, 0);
  const loaded = active.reduce((a, i) => a + i.loaded, 0);
  const speed = active.reduce((a, i) => a + (i.status === 'uploading' ? i.speed : 0), 0);
  const eta = speed > 0 ? (total - loaded) / speed : Infinity;

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card className="fixed right-4 bottom-4 z-40 w-[min(26rem,calc(100vw-2rem))] gap-0 py-0" aria-label="Uploads">
        <CardHeader className="border-b px-4 py-3 [.border-b]:pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Upload className="size-4 text-primary" />
            {active.length
              ? `Uploading ${active.length} file${active.length === 1 ? '' : 's'}`
              : paused.length
                ? `${paused.length} upload${paused.length === 1 ? '' : 's'} paused`
                : 'Uploads finished'}
          </CardTitle>
          <CardDescription className="text-xs">
            {active.length ? (
              `${formatSpeed(speed)} · ${Number.isFinite(eta) ? `${formatDuration(eta)} left` : 'starting…'}`
            ) : failed.length ? (
              <span className="text-destructive">{failed.length} failed</span>
            ) : (
              'All done'
            )}
          </CardDescription>
          <CardAction className="flex items-center gap-1">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={open ? 'Collapse' : 'Expand'}>
                <ChevronDown className={cn('transition-transform', !open && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
            {active.length || paused.length ? (
              <Button variant="ghost" size="sm" onClick={() => uploadQueue.cancelAll()}>
                Cancel all
              </Button>
            ) : (
              <IconButton label="Close" onClick={() => uploadQueue.clearFinished()}>
                <X />
              </IconButton>
            )}
          </CardAction>
          {active.length > 0 && <Progress value={total ? (loaded / total) * 100 : 0} className="col-span-full mt-2 h-1" />}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="max-h-72 overflow-y-auto px-0 py-1">
            <ul>
              {items.map((i) => (
                <li key={i.id} className="flex items-center gap-2 px-4 py-1.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate" title={i.key}>
                      {i.key.split('/').pop()}
                    </p>
                    {i.status === 'uploading' || i.status === 'paused' ? (
                      <div className="mt-1 flex items-center gap-2">
                        <Progress value={i.file.size ? (i.loaded / i.file.size) * 100 : 100} className="h-1.5" />
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {i.status === 'paused' ? 'Paused · ' : i.resumed ? 'Resumed · ' : ''}
                          {formatBytes(i.loaded)} / {formatBytes(i.file.size)}
                        </span>
                      </div>
                    ) : (
                      <p className={cn('truncate text-xs', i.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
                        {i.status === 'error'
                          ? i.error
                          : i.status === 'queued'
                            ? `Queued · ${formatBytes(i.file.size)}`
                            : i.status === 'cancelled'
                              ? 'Cancelled'
                              : formatBytes(i.file.size)}
                      </p>
                    )}
                  </div>
                  {i.status === 'done' && <Check className="size-4 text-primary" />}
                  {i.status === 'error' && (
                    <>
                      <CircleAlert className="size-4 text-destructive" />
                      <IconButton label="Retry" onClick={() => uploadQueue.retry(i.id)}>
                        <RotateCw />
                      </IconButton>
                    </>
                  )}
                  {i.status === 'uploading' && i.file.size > 16 * 1024 * 1024 && (
                    <IconButton label="Pause" onClick={() => uploadQueue.pause(i.id)}>
                      <Pause />
                    </IconButton>
                  )}
                  {i.status === 'paused' && (
                    <IconButton label="Resume" onClick={() => uploadQueue.resume(i.id)}>
                      <Play />
                    </IconButton>
                  )}
                  {(i.status === 'uploading' || i.status === 'queued' || i.status === 'paused') && (
                    <IconButton label="Cancel upload" onClick={() => uploadQueue.cancel(i.id)}>
                      <X />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
