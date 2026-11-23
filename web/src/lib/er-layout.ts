import { graphlib, layout } from '@dagrejs/dagre';
import type { GraphColumn, GraphForeignKey, GraphTable, SchemaGraph } from '@shared/types';

export const NODE_WIDTH = 264;
export const HEADER_H = 40;
export const ROW_H = 26;
const PAD_B = 6;

export type ColumnMode = 'keys' | 'all';

export interface TableBox {
  id: string;
  table: GraphTable;
  columns: (GraphColumn & { fk: boolean; referenced: boolean })[];
  hidden: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Link {
  id: string;
  fk: GraphForeignKey;
  /** Referenced table (drawn on the left) and the column the line leaves from. */
  source: string;
  sourceColumn: string;
  /** Referencing table and its foreign-key column. */
  target: string;
  targetColumn: string;
}

export const tableId = (schema: string, name: string) => `${schema}.${name}`;

/**
 * "Hub" tables are referenced by so many others (users, tenants, …) that drawing
 * every link to them buries the rest of the structure.
 */
export function findHubs(graph: SchemaGraph, visible: Set<string>): Map<string, number> {
  const refs = new Map<string, Set<string>>();
  for (const f of graph.foreignKeys) {
    const child = tableId(f.schema, f.table);
    const parent = tableId(f.refSchema, f.refTable);
    if (child === parent || !visible.has(child) || !visible.has(parent)) continue;
    (refs.get(parent) ?? refs.set(parent, new Set()).get(parent)!).add(child);
  }
  const threshold = Math.max(10, Math.ceil(visible.size * 0.25));
  return new Map([...refs].filter(([, v]) => v.size >= threshold).map(([k, v]) => [k, v.size]));
}

/** Tables within `depth` foreign-key hops of `focus`, in either direction. Hubs are reached but not expanded. */
export function neighbourhood(graph: SchemaGraph, focus: string, depth: number, hubs: Set<string> = new Set()): Set<string> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
  for (const f of graph.foreignKeys) {
    const a = tableId(f.schema, f.table);
    const b = tableId(f.refSchema, f.refTable);
    link(a, b);
    link(b, a);
  }
  const seen = new Set([focus]);
  let frontier = [focus];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      if (id !== focus && hubs.has(id)) continue;
      for (const n of adj.get(id) ?? []) if (!seen.has(n)) (seen.add(n), next.push(n));
    }
    frontier = next;
  }
  return seen;
}

/** Lay out the visible tables: dagre left-to-right for related tables, a grid for loners below. */
export function layoutDiagram(
  graph: SchemaGraph,
  visible: Set<string>,
  mode: ColumnMode,
  /** Links to these tables are left out (their FK columns still show). */
  hiddenTargets: Set<string> = new Set(),
): { boxes: TableBox[]; links: Link[]; hiddenLinks: number } {
  const fkCols = new Map<string, Set<string>>();
  const refCols = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, id: string, cols: string[]) => {
    const s = m.get(id) ?? m.set(id, new Set()).get(id)!;
    for (const c of cols) s.add(c);
  };
  const links: Link[] = [];
  let hiddenLinks = 0;
  for (const f of graph.foreignKeys) {
    const child = tableId(f.schema, f.table);
    const parent = tableId(f.refSchema, f.refTable);
    if (!visible.has(child) || !visible.has(parent)) continue;
    add(fkCols, child, f.columns);
    add(refCols, parent, f.refColumns);
    if (hiddenTargets.has(parent) && child !== parent) {
      hiddenLinks++;
      continue;
    }
    links.push({ id: `${child}:${f.name}`, fk: f, source: parent, sourceColumn: f.refColumns[0]!, target: child, targetColumn: f.columns[0]! });
  }

  const boxes: TableBox[] = graph.tables
    .filter((t) => visible.has(tableId(t.schema, t.name)))
    .map((t) => {
      const id = tableId(t.schema, t.name);
      const fks = fkCols.get(id) ?? new Set();
      const refs = refCols.get(id) ?? new Set();
      const all = t.columns.map((c) => ({ ...c, fk: fks.has(c.name), referenced: refs.has(c.name) }));
      const columns = mode === 'all' ? all : all.filter((c) => c.pk || c.fk || c.referenced);
      return {
        id,
        table: t,
        columns,
        hidden: all.length - columns.length,
        x: 0,
        y: 0,
        width: NODE_WIDTH,
        height: HEADER_H + columns.length * ROW_H + (all.length - columns.length > 0 ? ROW_H : 0) + PAD_B,
      };
    });

  const linked = new Set(links.flatMap((l) => [l.source, l.target]));
  const g = new graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 110, edgesep: 12, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const b of boxes) if (linked.has(b.id)) g.setNode(b.id, { width: b.width, height: b.height });
  for (const l of links) if (l.source !== l.target) g.setEdge(l.source, l.target, {}, l.id);
  layout(g);

  let maxX = 0;
  let maxY = 0;
  for (const b of boxes) {
    if (!linked.has(b.id)) continue;
    const n = g.node(b.id) as { x: number; y: number };
    b.x = n.x - b.width / 2;
    b.y = n.y - b.height / 2;
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }

  wrapTallRanks(boxes.filter((b) => linked.has(b.id)));
  maxX = 0;
  maxY = 0;
  for (const b of boxes) {
    if (!linked.has(b.id)) continue;
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }

  // Unrelated tables: a grid under the graph, as wide as the graph (at least 4 columns).
  const loners = boxes.filter((b) => !linked.has(b.id));
  if (loners.length) {
    const gap = 28;
    const perRow = Math.max(4, Math.floor((maxX || NODE_WIDTH * 4) / (NODE_WIDTH + gap)));
    let y = linked.size ? maxY + 90 : 20;
    for (let i = 0; i < loners.length; i += perRow) {
      const row = loners.slice(i, i + perRow);
      row.forEach((b, j) => {
        b.x = 20 + j * (NODE_WIDTH + gap);
        b.y = y;
      });
      y += Math.max(...row.map((b) => b.height)) + gap;
    }
  }
  return { boxes, links, hiddenLinks };
}

/**
 * dagre puts every table of a rank in one column; a parent with 50 children
 * becomes a column kilometres tall. Split such columns into several, shifting
 * later ranks right to make room.
 */
function wrapTallRanks(boxes: TableBox[]): void {
  const MAX_H = 1800;
  const GAP_X = 40;
  const GAP_Y = 24;
  const ranks = new Map<number, TableBox[]>();
  for (const b of boxes) {
    const key = Math.round(b.x);
    (ranks.get(key) ?? ranks.set(key, []).get(key)!).push(b);
  }
  let shift = 0;
  for (const x of [...ranks.keys()].sort((a, b) => a - b)) {
    const col = ranks.get(x)!.sort((a, b) => a.y - b.y);
    const height = col.reduce((h, b) => h + b.height + GAP_Y, 0);
    for (const b of col) b.x += shift;
    if (height <= MAX_H) continue;
    const top = col[0]!.y;
    let sub = 0;
    let y = top;
    for (const b of col) {
      if (y > top && y + b.height > top + MAX_H) {
        sub++;
        y = top;
      }
      b.x = x + shift + sub * (b.width + GAP_X);
      b.y = y;
      y += b.height + GAP_Y;
    }
    shift += sub * (col[0]!.width + GAP_X);
  }
}
