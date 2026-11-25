import { CircleAlert, Database, Plus } from 'lucide-react';
import { useState } from 'react';
import { errorText } from '@/api/client';
import { useBuckets } from '@/api/hooks';
import { useApp } from '@/components/app/app-context';
import { CreateBucketDialog } from '@/components/app/bucket-dialogs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/format';
import { hrefFor, navigate } from '@/lib/router';

/** Landing page: every bucket the connection can see. */
export function BucketsHome() {
  const { connection, isAdmin, me } = useApp();
  const buckets = useBuckets();
  const [createOpen, setCreateOpen] = useState(false);
  const canCreate = isAdmin && !me.readonly && connection.capabilities.bucketCreate && !buckets.data?.fallback;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="px-6 py-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Buckets</h1>
            <p className="text-sm text-muted-foreground">
              {connection.providerName}
              {connection.endpoint ? ` at ${connection.endpoint}` : ''} · region {connection.region}
              {connection.accessKeyHint ? ` · key ${connection.accessKeyHint}` : ''}
            </p>
          </div>
          {canCreate && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus /> New bucket
            </Button>
          )}
        </div>

        {buckets.data?.fallback && (
          <Alert className="mb-4">
            <CircleAlert />
            <AlertDescription>This key can’t list buckets, so only the configured buckets are shown.</AlertDescription>
          </Alert>
        )}

        {buckets.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : buckets.isError ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>Couldn’t list buckets: {errorText(buckets.error)}</AlertDescription>
          </Alert>
        ) : buckets.data.buckets.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Database />
              </EmptyMedia>
              <EmptyTitle>No buckets yet</EmptyTitle>
              <EmptyDescription>
                {canCreate ? 'Create one to get started.' : 'This key has no buckets.'}
              </EmptyDescription>
            </EmptyHeader>
            {canCreate && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> New bucket
              </Button>
            )}
          </Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {buckets.data.buckets.map((b) => (
              <a
                key={b.name}
                href={hrefFor({ bucket: b.name })}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                  e.preventDefault();
                  navigate({ bucket: b.name });
                }}
                className="rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Card className="gap-1 py-4 transition-colors hover:border-primary/40 hover:bg-accent/40">
                  <CardHeader className="px-4">
                    <CardTitle className="flex items-center gap-2 truncate text-sm">
                      <Database className="size-4 shrink-0 text-primary" />
                      <span className="truncate">{b.name}</span>
                    </CardTitle>
                    <CardDescription className="flex flex-wrap items-center gap-1.5 text-xs">
                      {b.region && <Badge variant="outline">{b.region}</Badge>}
                      {b.createdAt ? `Created ${formatDate(b.createdAt)}` : 'Configured bucket'}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </a>
            ))}
          </div>
        )}
      </div>
      <CreateBucketDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
