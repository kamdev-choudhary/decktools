import type { LiveActivity } from '@shared/types';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { TruncatedText } from '../TruncatedText';

function StateDot({ state }: { state: string | null }) {
  const tone =
    state === 'active' ? 'bg-success' : state?.startsWith('idle in transaction') ? 'bg-warning' : 'bg-muted-foreground/40';
  return <span className={cn('inline-block size-1.5 shrink-0 rounded-full', tone)} />;
}

/** Live list of client sessions on this database (pgdeck's own pool excluded). */
export function ActiveSessions({ activity, ready }: { activity: LiveActivity[]; ready: boolean }) {
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
            </colgroup>
            <thead className="sticky top-0 border-b bg-grid-header text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">PID</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">State</th>
                <th className="px-4 py-2 text-right font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Query</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
