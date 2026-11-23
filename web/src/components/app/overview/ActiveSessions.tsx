import { useMutation } from '@tanstack/react-query';
import { Ban, Copy, MoreHorizontal, Route, SquareTerminal, Unplug } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { LiveActivity } from '@shared/types';
import { api } from '@/api/client';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { openInSqlEditor } from '@/lib/sql-draft';
import { errorMessage, Spinner } from '../feedback';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { TruncatedText } from '../TruncatedText';

function StateDot({ state }: { state: string | null }) {
  const tone =
    state === 'active' ? 'bg-success' : state?.startsWith('idle in transaction') ? 'bg-warning' : 'bg-muted-foreground/40';
  return <span className={cn('inline-block size-1.5 shrink-0 rounded-full', tone)} />;
}

/** Live list of client sessions on this database (pgdeck's own pool excluded). */
export function ActiveSessions({ db, readonly, activity, ready }: { db: string; readonly: boolean; activity: LiveActivity[]; ready: boolean }) {
  const [terminating, setTerminating] = useState<LiveActivity | null>(null);
  const signal = useMutation({
    mutationFn: (v: { pid: number; terminate: boolean }) => api.signalSession(db, v.pid, v.terminate),
    onSuccess: (r) => {
      toast.success(r.message);
      setTerminating(null);
    },
    onError: (e) => toast.error('Could not signal the session', { description: errorMessage(e) }),
  });

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-medium">
          Sessions <span className="text-muted-foreground tabular-nums">{activity.length}</span>
        </h2>
        <span className="text-xs text-muted-foreground">Excludes pgdeck's own connections</span>
      </div>
      {!activity.length ? (
        <p className="p-6 text-center text-sm text-muted-foreground">{ready ? 'No other sessions connected.' : 'Waiting for data…'}</p>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-20" />
              <col className="w-40" />
              <col className="w-44" />
              <col className="w-20" />
              <col />
              <col className="w-12" />
            </colgroup>
            <thead className="sticky top-0 border-b bg-grid-header text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">PID</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">State</th>
                <th className="px-4 py-2 text-right font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Query</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y">
              {activity.map((a) => (
                <tr key={a.pid} className="hover:bg-muted/40">
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground tabular-nums">{a.pid}</td>
                  <td className="px-4 py-2">
                    <TruncatedText text={a.application || a.user || '—'} className="text-[13px]" />
                    <TruncatedText text={`${a.user ?? ''}${a.client ? ` · ${a.client}` : ''}`} className="text-xs text-muted-foreground" />
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2 text-[13px]">
                      <StateDot state={a.state} />
                      <TruncatedText text={a.state ?? 'unknown'} />
                    </span>
                    {a.waitEvent && <span className="text-xs text-muted-foreground">waiting: {a.waitEvent}</span>}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-muted-foreground tabular-nums">
                    {a.durationSeconds !== null ? (a.durationSeconds < 60 ? `${a.durationSeconds.toFixed(1)}s` : formatDuration(a.durationSeconds)) : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <TruncatedText text={a.query.replace(/\s+/g, ' ').trim() || '—'} tooltip={<pre className="font-mono whitespace-pre-wrap">{a.query}</pre>} className="font-mono text-xs" />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label={`Actions for session ${a.pid}`} className="text-muted-foreground">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {a.query.trim() && (
                          <>
                            <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(a.query).then(() => toast.success('Copied query'))}>
                              <Copy /> Copy query
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => openInSqlEditor(db, a.query, { explain: true })}>
                              <Route /> Explain query
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => openInSqlEditor(db, a.query)}>
                              <SquareTerminal /> Open in SQL editor
                            </DropdownMenuItem>
                          </>
                        )}
                        {!readonly && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem disabled={a.state !== 'active' || signal.isPending} onSelect={() => signal.mutate({ pid: a.pid, terminate: false })}>
                              <Ban /> Cancel running query
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onSelect={() => setTerminating(a)}>
                              <Unplug /> Terminate session…
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {terminating && (
        <AlertDialog open onOpenChange={(o) => !o && !signal.isPending && setTerminating(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Terminate session {terminating.pid}?</AlertDialogTitle>
              <AlertDialogDescription>
                Its connection is closed and any open transaction is rolled back. The client ({terminating.application || terminating.user || 'unknown'}) will see a
                connection error.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={signal.isPending}>Cancel</AlertDialogCancel>
              <Button variant="destructive" disabled={signal.isPending} onClick={() => signal.mutate({ pid: terminating.pid, terminate: true })}>
                {signal.isPending && <Spinner className="text-current" />}
                Terminate
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
