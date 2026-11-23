import type { PlanNode } from '@shared/types';

/** A plan node with derived figures for display. */
export interface AnalyzedNode {
  id: number;
  depth: number;
  node: PlanNode;
  label: string;
  detail: string | null;
  /** Inclusive time in ms (analyze) or total cost (estimate). */
  total: number;
  /** Time or cost spent in this node alone. */
  self: number;
  /** self as a share of the whole plan, 0..1. */
  share: number;
  /** Actual rows per loop, or the estimate when not analyzed. */
  rows: number;
  estRows: number;
  loops: number;
  /** max(actual, estimate) / min(actual, estimate), analyze only. */
  misestimate: number | null;
  warnings: string[];
  children: AnalyzedNode[];
}

export interface PlanAnalysis {
  root: AnalyzedNode;
  flat: AnalyzedNode[];
  analyzed: boolean;
  /** Denominator for shares: execution time (ms) or root total cost. */
  whole: number;
  slowest: AnalyzedNode | null;
  warnings: { node: AnalyzedNode; text: string }[];
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const fmtInt = (n: number) => Math.round(n).toLocaleString();

function describe(n: PlanNode): { label: string; detail: string | null } {
  let label = n['Node Type'];
  if (label === 'Aggregate' && n.Strategy === 'Hashed') label = 'HashAggregate';
  if (label === 'Aggregate' && n.Strategy === 'Sorted') label = 'GroupAggregate';
  if (n['Parallel Aware']) label = `Parallel ${label}`;
  if (typeof n['Join Type'] === 'string' && n['Join Type'] !== 'Inner') label += ` (${n['Join Type']})`;

  const parts: string[] = [];
  const rel = n['Relation Name'] as string | undefined;
  const alias = n.Alias as string | undefined;
  if (rel) parts.push(`on ${n.Schema && n.Schema !== 'public' ? `${n.Schema}.` : ''}${rel}${alias && alias !== rel ? ` ${alias}` : ''}`);
  else if (n['CTE Name']) parts.push(`on ${n['CTE Name']}`);
  else if (n['Function Name']) parts.push(`on ${n['Function Name']}()`);
  if (n['Index Name']) parts.push(`using ${n['Index Name']}`);
  if (Array.isArray(n['Sort Key'])) parts.push(`by ${(n['Sort Key'] as string[]).join(', ')}`);
  if (n['Subplan Name']) parts.push(String(n['Subplan Name']));
  return { label, detail: parts.length ? parts.join(' ') : null };
}

/** Postgres EXPLAIN JSON → a tree with self time, shares and warnings. */
export function analyzePlan(plan: PlanNode, analyzed: boolean, executionMs: number | undefined): PlanAnalysis {
  let id = 0;
  const flat: AnalyzedNode[] = [];

  // Inclusive time of a node across all its loops. Workers under Gather run
  // concurrently, so their per-loop time already reflects wall time.
  const inclusive = (n: PlanNode, parallel: boolean): number => {
    if (!analyzed) return num(n['Total Cost']);
    const t = num(n['Actual Total Time']);
    return parallel ? t : t * Math.max(1, num(n['Actual Loops']));
  };

  const walk = (n: PlanNode, depth: number, parallel: boolean): AnalyzedNode => {
    const childParallel = parallel || n['Node Type'] === 'Gather' || n['Node Type'] === 'Gather Merge';
    const total = inclusive(n, parallel);
    const { label, detail } = describe(n);
    const loops = Math.max(1, num(n['Actual Loops']));
    const est = num(n['Plan Rows']);
    const actual = num(n['Actual Rows']);
    const me: AnalyzedNode = {
      id: id++,
      depth,
      node: n,
      label,
      detail,
      total,
      self: 0,
      share: 0,
      rows: analyzed ? actual : est,
      estRows: est,
      loops,
      misestimate: analyzed && (actual > 0 || est > 0) ? Math.max(actual, est) / Math.max(Math.min(actual, est), 1) : null,
      warnings: [],
      children: [],
    };
    flat.push(me);
    me.children = (n.Plans ?? []).map((c) => walk(c, depth + 1, childParallel));
    me.self = Math.max(0, total - me.children.reduce((s, c) => s + c.total, 0));
    return me;
  };

  const root = walk(plan, 0, false);
  const whole = analyzed ? Math.max(num(executionMs), root.total, 0.001) : Math.max(root.total, 0.001);

  for (const a of flat) {
    a.share = Math.min(1, a.self / whole);
    const n = a.node;
    const removed = num(n['Rows Removed by Filter']) * a.loops;
    const kept = a.rows * a.loops;
    if (analyzed && removed > 1000 && removed > kept * 2) {
      a.warnings.push(`The filter threw away ${fmtInt(removed)} rows to keep ${fmtInt(kept)}. An index on the filtered column could avoid reading them.`);
    }
    if (n['Sort Space Type'] === 'Disk') {
      a.warnings.push(`The sort spilled ${fmtInt(num(n['Sort Space Used']))} kB to disk. A higher work_mem would keep it in memory.`);
    }
    if (num(n['Hash Batches']) > 1) {
      a.warnings.push(`The hash table needed ${n['Hash Batches']} batches. A higher work_mem would fit it in one.`);
    }
    if (a.misestimate !== null && a.misestimate >= 10 && Math.max(a.rows, a.estRows) >= 100) {
      a.warnings.push(
        `Postgres expected ${fmtInt(a.estRows)} rows and got ${fmtInt(a.rows)} (${Math.round(a.misestimate)}× off). Running ANALYZE on the table usually fixes the estimate.`,
      );
    }
    if (num(n['Temp Written Blocks']) > 0 && n['Sort Space Type'] !== 'Disk') {
      a.warnings.push(`Wrote ${fmtInt(num(n['Temp Written Blocks']) * 8)} kB of temporary files.`);
    }
  }

  const slowest = flat.length > 1 ? flat.reduce((m, a) => (a.self > m.self ? a : m), flat[0]!) : null;
  return {
    root,
    flat,
    analyzed,
    whole,
    slowest: slowest && slowest.share >= 0.05 ? slowest : null,
    warnings: flat.flatMap((node) => node.warnings.map((text) => ({ node, text }))),
  };
}

/** Node properties worth showing in the details panel, in display order. */
export const DETAIL_KEYS = [
  'Filter',
  'Index Cond',
  'Recheck Cond',
  'Hash Cond',
  'Merge Cond',
  'Join Filter',
  'One-Time Filter',
  'Sort Key',
  'Sort Method',
  'Group Key',
  'Rows Removed by Filter',
  'Rows Removed by Index Recheck',
  'Rows Removed by Join Filter',
  'Heap Fetches',
  'Workers Planned',
  'Workers Launched',
  'Hash Buckets',
  'Hash Batches',
  'Peak Memory Usage',
  'Sort Space Used',
  'Sort Space Type',
  'Shared Hit Blocks',
  'Shared Read Blocks',
  'Temp Read Blocks',
  'Temp Written Blocks',
  'Startup Cost',
  'Total Cost',
  'Parent Relationship',
] as const;
