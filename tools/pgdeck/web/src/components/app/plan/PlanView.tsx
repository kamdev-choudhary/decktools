import { AlertTriangle, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Flame } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ExplainResponse } from '@shared/types';
import { Badge } from '@deck/ui/components/badge';
import { Button } from '@deck/ui/components/button';
import { analyzePlan, DETAIL_KEYS, type AnalyzedNode } from '@/lib/plan';
import { cn } from '@deck/ui/lib/utils';

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : v >= 10 ? `${v.toFixed(1)} ms` : `${v.toFixed(2)} ms`);
const cost = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(0)}k` : v.toFixed(v < 10 ? 2 : 0));
const int = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : Math.round(v).toLocaleString());

/** EXPLAIN output as an expandable tree with time shares, row estimates and warnings. */
export function PlanView({ result }: { result: ExplainResponse }) {
  const exec = result.plan['Execution Time'];
  const planning = result.plan['Planning Time'];
  const a = useMemo(() => analyzePlan(result.plan.Plan, result.analyzed, exec), [result, exec]);
  const [open, setOpen] = useState<Set<number>>(() => new Set(a.warnings.map((w) => w.node.id)));
  const allOpen = open.size >= a.flat.length;

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-grid-header px-4 py-2 text-xs text-muted-foreground md:px-6">
        <span className="font-mono font-medium text-foreground">{result.analyzed ? 'EXPLAIN ANALYZE' : 'EXPLAIN'}</span>
        {exec !== undefined && (
          <span>
            Execution <span className="font-medium text-foreground tabular-nums">{ms(exec)}</span>
          </span>
        )}
        {planning !== undefined && (
          <span>
            Planning <span className="tabular-nums">{ms(planning)}</span>
          </span>
        )}
        {!result.analyzed && (
          <span>
            Estimated cost <span className="font-medium text-foreground tabular-nums">{cost(a.root.total)}</span>
          </span>
        )}
        {result.analyzed && <Badge variant="outline">Ran, then rolled back</Badge>}
        {result.generic && <Badge variant="outline">Generic plan for $n parameters</Badge>}
        <div className="flex-1" />
        <Button variant="ghost" size="xs" onClick={() => setOpen(allOpen ? new Set() : new Set(a.flat.map((n) => n.id)))}>
          {allOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}
          {allOpen ? 'Collapse details' : 'Expand details'}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void navigator.clipboard.writeText(JSON.stringify([result.plan], null, 2)).then(() => toast.success('Copied plan as JSON'))}
        >
          <Copy /> Copy JSON
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {(a.slowest || a.warnings.length > 0) && (
          <ul className="space-y-1.5 border-b px-4 py-3 text-[13px] md:px-6">
            {a.slowest && (
              <li className="flex items-start gap-2">
                <Flame className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>
                  Most of the {result.analyzed ? 'time' : 'cost'} is in{' '}
                  <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setOpen((p) => new Set(p).add(a.slowest!.id))}>
                    {a.slowest.label}
                    {a.slowest.detail ? ` ${a.slowest.detail}` : ''}
                  </button>{' '}
                  <span className="text-muted-foreground">({Math.round(a.slowest.share * 100)}%{result.analyzed ? `, ${ms(a.slowest.self)}` : ''})</span>
                </span>
              </li>
            )}
            {a.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>
                  <span className="font-medium">{w.node.label}</span>
                  {w.node.detail && <span className="text-muted-foreground"> {w.node.detail}</span>}: {w.text}
                </span>
              </li>
            ))}
          </ul>
        )}

        <table className="w-full min-w-[46rem] text-[13px]">
          <thead className="sticky top-0 z-10 border-b bg-grid-header text-xs text-muted-foreground">
            <tr className="text-left">
              <th className="px-4 py-2 font-medium md:pl-6">Step</th>
              <th className="w-56 px-3 py-2 font-medium">{result.analyzed ? 'Time in this step' : 'Cost of this step'}</th>
              <th className="w-36 px-3 py-2 text-right font-medium">{result.analyzed ? 'Rows (estimated)' : 'Rows'}</th>
              <th className="w-16 px-3 py-2 text-right font-medium">Loops</th>
              <th className="w-24 px-3 py-2 text-right font-medium md:pr-6">Total cost</th>
            </tr>
          </thead>
          <tbody>
            {a.flat.map((n) => (
              <PlanRow key={n.id} n={n} analyzed={result.analyzed} slowest={a.slowest?.id === n.id} open={open.has(n.id)} onToggle={() => toggle(n.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PlanRow({ n, analyzed, slowest, open, onToggle }: { n: AnalyzedNode; analyzed: boolean; slowest: boolean; open: boolean; onToggle: () => void }) {
  const details = DETAIL_KEYS.filter((k) => n.node[k] !== undefined && n.node[k] !== null && !(Array.isArray(n.node[k]) && !(n.node[k] as unknown[]).length));
  const pct = Math.round(n.share * 100);
  return (
    <>
      <tr className={cn('group border-b border-border/60 hover:bg-muted/40', slowest && 'bg-warning/[0.06]')}>
        <td className="py-1.5 pr-3 pl-4 md:pl-6">
          <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full min-w-0 items-center gap-1.5 text-left" style={{ paddingLeft: `${n.depth * 1.1}rem` }}>
            <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90', !details.length && 'invisible')} />
            <span className={cn('shrink-0 font-medium', slowest && 'text-warning')}>{n.label}</span>
            {n.detail && <span className="truncate font-mono text-xs text-muted-foreground">{n.detail}</span>}
            {n.warnings.length > 0 && <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-label="Has a warning" />}
          </button>
        </td>
        <td className="px-3 py-1.5">
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className={cn('h-full rounded-full', slowest ? 'bg-warning' : 'bg-chart-data')} style={{ width: `${Math.max(pct, n.self > 0 ? 1 : 0)}%` }} />
            </div>
            <span className="w-24 shrink-0 text-right text-xs tabular-nums">
              {analyzed ? ms(n.self) : cost(n.self)} <span className="text-muted-foreground">{pct}%</span>
            </span>
          </div>
        </td>
        <td className="px-3 py-1.5 text-right text-xs tabular-nums">
          {int(n.rows)}
          {analyzed && <span className="text-muted-foreground"> ({int(n.estRows)})</span>}
          {n.misestimate !== null && n.misestimate >= 10 && (
            <span className="ml-1 rounded bg-warning/15 px-1 text-[10px] font-medium text-warning" title="Row estimate was off by this factor">
              {Math.round(n.misestimate)}×
            </span>
          )}
        </td>
        <td className="px-3 py-1.5 text-right text-xs text-muted-foreground tabular-nums">{analyzed ? int(n.loops) : '—'}</td>
        <td className="px-3 py-1.5 text-right text-xs text-muted-foreground tabular-nums md:pr-6">{cost(Number(n.node['Total Cost'] ?? 0))}</td>
      </tr>
      {open && details.length > 0 && (
        <tr className="border-b border-border/60 bg-muted/20">
          <td colSpan={5} className="py-2 pr-6 pl-4 md:pl-6">
            <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]" style={{ marginLeft: `${n.depth * 1.1 + 1.25}rem` }}>
              {details.map((k) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-mono break-all">{Array.isArray(n.node[k]) ? (n.node[k] as unknown[]).join(', ') : String(n.node[k])}</dd>
                </div>
              ))}
            </dl>
            {n.warnings.map((w, i) => (
              <p key={i} className="mt-2 flex items-start gap-1.5 text-xs text-warning" style={{ marginLeft: `${n.depth * 1.1 + 1.25}rem` }}>
                <AlertTriangle className="mt-px size-3.5 shrink-0" /> {w}
              </p>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}
