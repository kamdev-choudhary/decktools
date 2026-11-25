import { History } from 'lucide-react';
import { useState } from 'react';
import { useActivity } from '@/api/hooks';
import { ErrorAlert } from '@/components/app/bucket-dialogs';
import { EmptyState } from '@/components/app/empty-state';
import { PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

function actionTone(action: string): 'destructive' | 'secondary' | 'outline' {
  if (/delete|failed|denied|forget|abort|empty/.test(action)) return 'destructive';
  if (/^(user|settings|bucket|sync)\./.test(action)) return 'secondary';
  return 'outline';
}

export function ActivityView() {
  const [user, setUser] = useState('');
  const [bucket, setBucket] = useState('');
  const activity = useActivity({ user: user.trim() || undefined, bucket: bucket.trim() || undefined, limit: 500 });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageHeader
        icon={<History />}
        title="Activity"
        description={
          activity.data?.persisted === false
            ? 'Changes made since s3deck started (not saved to disk: --no-persist).'
            : 'Every change, who made it and from where. Kept in activity.jsonl in the data directory.'
        }
      />
      <div className="space-y-4 p-6">
        <div className="flex flex-wrap gap-2">
          <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Filter by user (exact)" className="h-8 w-56" aria-label="Filter by user" />
          <Input value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="Filter by bucket (exact)" className="h-8 w-56" aria-label="Filter by bucket" />
        </div>
        {activity.isError && <ErrorAlert error={activity.error} />}
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-40 pl-4">When</TableHead>
                <TableHead className="w-40">User</TableHead>
                <TableHead className="w-44">Action</TableHead>
                <TableHead className="w-40">Bucket</TableHead>
                <TableHead>Details</TableHead>
                <TableHead className="w-32 pr-4">From</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activity.isPending &&
                Array.from({ length: 6 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6} className="pl-4">
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {activity.data?.entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="pl-4 text-muted-foreground" title={formatDate(e.at)}>
                    {formatRelative(e.at)}
                  </TableCell>
                  <TableCell className="truncate font-medium">
                    <button type="button" className="hover:underline" onClick={() => setUser(e.user)}>
                      {e.user}
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge variant={actionTone(e.action)} className="font-mono text-[11px]">
                      {e.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="truncate">
                    {e.bucket ? (
                      <button type="button" className="hover:underline" onClick={() => setBucket(e.bucket ?? '')}>
                        {e.bucket}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className={cn('max-w-0 truncate font-mono text-xs', !e.detail && 'text-muted-foreground')} title={e.detail ?? undefined}>
                    {e.detail ?? '—'}
                    {e.connection && <span className="ml-2 font-sans text-muted-foreground">· {e.connection}</span>}
                  </TableCell>
                  <TableCell className="pr-4 font-mono text-xs text-muted-foreground">{e.ip}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {activity.data?.entries.length === 0 && (
            <EmptyState icon={<History />} title="Nothing yet">
              {user || bucket ? 'No changes match these filters.' : 'Uploads, deletes, settings changes and sign-ins show up here.'}
            </EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}
