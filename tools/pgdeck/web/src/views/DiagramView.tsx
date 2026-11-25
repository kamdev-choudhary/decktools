import '@xyflow/react/dist/style.css';
import { useQuery } from '@tanstack/react-query';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getNodesBounds,
  getViewportForBounds,
  useReactFlow,
  type Edge,
  type Node,
  MarkerType,
  type NodeChangeset,
  type NodeProps,
  type XYPosition,
} from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';
import { Download, ExternalLink, KeyRound, Link2, Maximize, Network, RotateCcw, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { keys } from '@/api/hooks';
import { Combobox } from '@deck/ui/components/combobox';
import { CenteredSpinner, ErrorAlert, errorMessage } from '@/components/app/feedback';
import { Button } from '@deck/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@deck/ui/components/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deck/ui/components/select';
import {
  findHubs,
  HEADER_H,
  layoutDiagram,
  neighbourhood,
  ROW_H,
  tableId,
  type ColumnMode,
  type TableBox,
} from '@/lib/er-layout';
import { diagramHref, navigate, tableHref } from '@/lib/router';
import { storage } from '@deck/ui/lib/storage';
import { useTheme } from '@deck/ui/components/theme-provider';
import { cn } from '@deck/ui/lib/utils';

type TableNodeData = { box: TableBox; state: 'normal' | 'active' | 'related' | 'dim'; db: string; hot: Set<string> };
type TableNode = Node<TableNodeData, 'table'>;

const compact = (n: number) =>
  n < 0 ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));

/** One table: header plus its (key) columns, with a handle on each side of every column. */
const TableCard = memo(function TableCard({ data }: NodeProps<TableNode>) {
  const { box, state, db, hot } = data;
  const t = box.table;
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-card text-card-foreground transition-opacity',
        state === 'active' && 'border-chart-data ring-2 ring-chart-data/25',
        state === 'related' && 'border-chart-data/50',
        state === 'dim' && 'opacity-30',
      )}
      style={{ width: box.width }}
    >
      <div className="flex items-center gap-2 border-b bg-grid-header px-3" style={{ height: HEADER_H }}>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold" title={`${t.schema}.${t.name}`}>
            {t.name}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {t.schema}
            {t.rows >= 0 && ` · ~${compact(t.rows)} rows`}
          </div>
        </div>
        <a
          href={tableHref(db, t.schema, t.name)}
          className="nodrag rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`Open ${t.name}`}
          title="Open table"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="size-3.5" />
        </a>
      </div>
      <div className="py-0.5">
        {box.columns.map((c) => (
          <div
            key={c.name}
            className={cn(
              'relative flex items-center gap-1.5 px-3 text-xs',
              hot.has(c.name) && 'bg-chart-data/12 text-foreground',
            )}
            style={{ height: ROW_H }}
          >
            <Handle
              type="target"
              position={Position.Left}
              id={`t:${c.name}`}
              className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent"
            />
            <span className="flex w-3.5 shrink-0 justify-center">
              {c.pk ? (
                <KeyRound className="size-3 text-warning" aria-label="Primary key" />
              ) : c.fk ? (
                <Link2 className="size-3 text-chart-data" aria-label="Foreign key" />
              ) : null}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 truncate font-mono',
                (c.pk || hot.has(c.name)) && 'font-medium',
                hot.has(c.name) && 'text-chart-data',
              )}
            >
              {c.name}
            </span>
            <span className="max-w-[45%] shrink-0 truncate font-mono text-[10px] text-muted-foreground">{c.type}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={`s:${c.name}`}
              className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent"
            />
          </div>
        ))}
        {box.hidden > 0 && (
          <div className="flex items-center px-3 pl-8 text-[11px] text-muted-foreground" style={{ height: ROW_H }}>
            +{box.hidden} more column{box.hidden === 1 ? '' : 's'}
          </div>
        )}
      </div>
    </div>
  );
});

const nodeTypes = { table: TableCard };
const EMPTY = new Set<string>();

export function DiagramView({ db, focus }: { db: string; focus: string | null }) {
  return (
    <ReactFlowProvider>
      <Diagram db={db} focus={focus} />
    </ReactFlowProvider>
  );
}

function Diagram({ db, focus }: { db: string; focus: string | null }) {
  const { resolved } = useTheme();
  const flow = useReactFlow();
  const graph = useQuery({ queryKey: [...keys.db(db), 'graph'], queryFn: () => api.graph(db) });
  const [schema, setSchema] = useState<string>('*');
  const [mode, setMode] = useState<ColumnMode | null>(null);
  const [depth, setDepth] = useState(1);
  const [selected, setSelected] = useState<string | null>(focus);
  const [showHubs, setShowHubs] = useState(false);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);

  // Following a link to another focus table selects it.
  const [selectedFor, setSelectedFor] = useState(focus);
  if (selectedFor !== focus) {
    setSelectedFor(focus);
    setSelected(focus);
  }

  const g = graph.data;
  const schemas = useMemo(() => [...new Set(g?.tables.map((t) => t.schema) ?? [])], [g]);
  // Big schemas start with key columns only; small ones show everything.
  const columnMode: ColumnMode = mode ?? ((g?.tables.length ?? 0) > 25 ? 'keys' : 'all');

  const allIds = useMemo(() => new Set(g?.tables.map((t) => tableId(t.schema, t.name)) ?? []), [g]);
  const globalHubs = useMemo(() => (g ? findHubs(g, allIds) : new Map<string, number>()), [g, allIds]);

  const visible = useMemo(() => {
    if (!g) return new Set<string>();
    if (focus && allIds.has(focus)) return neighbourhood(g, focus, depth, new Set(globalHubs.keys()));
    return new Set(g.tables.filter((t) => schema === '*' || t.schema === schema).map((t) => tableId(t.schema, t.name)));
  }, [g, focus, depth, schema, allIds, globalHubs]);

  // Links to hubs are left out of the layout unless asked for (or the hub is the focus).
  // Selecting a hub draws its links on top without moving anything.
  const hubs = useMemo(() => (g ? findHubs(g, visible) : new Map<string, number>()), [g, visible]);
  const hidden = useMemo(
    () => (showHubs ? new Set<string>() : new Set([...hubs.keys()].filter((h) => h !== focus))),
    [showHubs, hubs, focus],
  );
  const laid = useMemo(
    () => (g ? layoutDiagram(g, visible, columnMode, hidden) : null),
    [g, visible, columnMode, hidden],
  );

  // Cards the user dragged, remembered per database and view so a refresh keeps the arrangement.
  const posKey = `pgdeck.diagram.${db}.${focus ? `focus:${focus}:${depth}` : `schema:${schema}`}.${columnMode}.${showHubs ? 'hubs' : 'nohubs'}`;
  const [moved, setMoved] = useState(() => storage.getJson<Record<string, XYPosition>>(posKey, {}));
  const [movedFor, setMovedFor] = useState(posKey);
  if (movedFor !== posKey) {
    setMovedFor(posKey);
    setMoved(storage.getJson<Record<string, XYPosition>>(posKey, {}));
  }
  const saveMoved = useCallback(
    (next: Record<string, XYPosition>) => {
      setMoved(next);
      if (Object.keys(next).length) storage.setJson(posKey, next);
      else storage.set(posKey, '{}');
    },
    [posKey],
  );
  const onNodesChange = useCallback(
    (changes: NodeChangeset<TableNode>) => {
      let next: Record<string, XYPosition> | null = null;
      for (const c of changes.getByType('position')) {
        if (c.position) (next ??= { ...moved })[c.id] = c.position;
      }
      if (next) saveMoved(next);
    },
    [moved, saveMoved],
  );

  // Highlight the selected table and its direct neighbours.
  const related = useMemo(() => {
    const s = new Set<string>();
    if (!selected || !laid) return s;
    for (const l of laid.links) {
      if (l.source === selected) s.add(l.target);
      if (l.target === selected) s.add(l.source);
    }
    for (const f of g?.foreignKeys ?? []) {
      const child = tableId(f.schema, f.table);
      const parent = tableId(f.refSchema, f.refTable);
      if (parent === selected) s.add(child);
      if (child === selected) s.add(parent);
    }
    return s;
  }, [selected, laid, g]);

  // Every link that will be drawn, plus a selected hub's links on top of the layout.
  const drawn = useMemo(() => {
    if (!laid || !g) return [];
    const links = [...laid.links];
    if (selected && hidden.has(selected)) {
      for (const f of g.foreignKeys) {
        const child = tableId(f.schema, f.table);
        if (tableId(f.refSchema, f.refTable) !== selected || child === selected || !visible.has(child)) continue;
        links.push({
          id: `${child}:${f.name}`,
          fk: f,
          source: selected,
          sourceColumn: f.refColumns[0]!,
          target: child,
          targetColumn: f.columns[0]!,
        });
      }
    }
    return links;
  }, [laid, g, selected, hidden, visible]);

  const isHot = useCallback(
    (l: { id: string; source: string; target: string }) =>
      l.id === hoverEdge || (!!selected && (l.source === selected || l.target === selected)),
    [hoverEdge, selected],
  );

  // Columns at either end of highlighted links, per table.
  const hot = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (id: string, cols: string[]) => {
      const set = m.get(id) ?? m.set(id, new Set()).get(id)!;
      for (const c of cols) set.add(c);
    };
    for (const l of drawn) {
      if (!isHot(l)) continue;
      add(l.source, l.fk.refColumns);
      add(l.target, l.fk.columns);
    }
    return m;
  }, [drawn, isHot]);

  const nodes = useMemo<TableNode[]>(
    () =>
      laid?.boxes.map((b) => ({
        id: b.id,
        type: 'table',
        position: moved[b.id] ?? { x: b.x, y: b.y },
        width: b.width,
        height: b.height,
        data: {
          box: b,
          db,
          hot: hot.get(b.id) ?? EMPTY,
          state: !selected ? 'normal' : b.id === selected ? 'active' : related.has(b.id) ? 'related' : 'dim',
        },
      })) ?? [],
    [laid, selected, related, db, moved, hot],
  );

  const accent = resolved === 'dark' ? '#3291ff' : '#0070f3';
  const quiet = resolved === 'dark' ? '#525252' : '#b4b4b4';
  const edges = useMemo<Edge[]>(
    () =>
      drawn.map((l) => {
        const on = isHot(l);
        const dim = (!!selected || !!hoverEdge) && !on;
        const color = on ? accent : quiet;
        return {
          id: l.id,
          source: l.source,
          target: l.target,
          sourceHandle: `s:${l.sourceColumn}`,
          targetHandle: `t:${l.targetColumn}`,
          // Curves keep each link distinct; right-angle routing merges them into shared trunks.
          type: 'default',
          zIndex: on ? 10 : 0,
          interactionWidth: 14,
          // The arrow points at the referenced table.
          markerStart: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
          style: { stroke: color, strokeWidth: on ? 2 : 1.25, opacity: dim ? 0.15 : 1 },
          label:
            l.id === hoverEdge
              ? `${l.fk.table}.${l.fk.columns.join(', ')} → ${l.fk.refTable}.${l.fk.refColumns.join(', ')}`
              : undefined,
          labelStyle: { fontFamily: 'var(--font-mono)', fontSize: 11, fill: 'var(--foreground)' },
          labelBgStyle: { fill: 'var(--background)', stroke: 'var(--border)' },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
        };
      }),
    [drawn, isHot, selected, hoverEdge, accent, quiet],
  );

  // Re-fit when the set of tables changes; centre on the focused table when there is one.
  // Deliberately keyed on the layout only: re-fitting on every node change would fight the user's panning.
  /* oxlint-disable react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies */
  useEffect(() => {
    if (!nodes.length) return;
    const t = setTimeout(() => {
      void flow.fitView({ padding: 0.08, maxZoom: 1, duration: 300 });
    }, 30);
    return () => clearTimeout(t);
  }, [laid]);
  /* oxlint-enable react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies */

  const exportImage = useCallback(
    async (kind: 'png' | 'svg') => {
      const el = document.querySelector<HTMLElement>('.pgdeck-flow .react-flow__viewport');
      if (!el || !nodes.length) return;
      const bounds = getNodesBounds(nodes);
      const width = Math.min(8000, Math.ceil(bounds.width + 80));
      const height = Math.min(8000, Math.ceil(bounds.height + 80));
      const vp = getViewportForBounds(bounds, width, height, 0.05, 2, 40);
      const opts = {
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        width,
        height,
        pixelRatio: kind === 'png' ? 2 : 1,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
        },
      };
      try {
        const url = kind === 'png' ? await toPng(el, opts) : await toSvg(el, opts);
        const a = Object.assign(document.createElement('a'), { href: url, download: `${db}-diagram.${kind}` });
        a.click();
      } catch (e) {
        toast.error('Could not export the diagram', { description: errorMessage(e) });
      }
    },
    [nodes, db],
  );

  if (graph.isPending) return <CenteredSpinner label="Reading the schema…" />;
  if (graph.isError) return <ErrorAlert error={graph.error} className="m-6 w-auto" />;
  if (!g!.tables.length) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">
        This database has no tables yet.
      </div>
    );
  }

  const tableOptions = g!.tables.map((t) => ({
    value: tableId(t.schema, t.name),
    label: t.schema === 'public' ? t.name : `${t.schema}.${t.name}`,
    hint: t.schema === 'public' ? undefined : t.schema,
  }));

  return (
    <div className="pgdeck-flow relative min-h-0 flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        forceColorMode={resolved}
        minZoom={0.05}
        maxZoom={2}
        onNodesChange={onNodesChange}
        nodesDraggable
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => setSelected((s) => (s === n.id ? null : n.id))}
        onNodeDoubleClick={(_, n) => {
          const t = (n.data as TableNodeData).box.table;
          navigate(tableHref(db, t.schema, t.name));
        }}
        onPaneClick={() => setSelected(focus)}
        onEdgeMouseEnter={(_, e) => setHoverEdge(e.id)}
        onEdgeMouseLeave={() => setHoverEdge(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable position="bottom-right" nodeBorderRadius={6} className="!hidden md:!block" />

        <Panel
          position="top-left"
          className="!m-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-2 backdrop-blur"
        >
          <Combobox
            value={focus ?? undefined}
            onChange={(v) => navigate(diagramHref(db, v))}
            options={tableOptions}
            placeholder="Focus on a table…"
            searchPlaceholder="Find a table…"
            mono
            className="w-56"
            aria-label="Focus on a table"
          />
          {focus ? (
            <>
              <Select value={String(depth)} onValueChange={(v) => setDepth(Number(v))}>
                <SelectTrigger size="sm" className="h-8 w-auto text-xs" aria-label="How far to follow relations">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1" className="text-xs">
                    Direct relations
                  </SelectItem>
                  <SelectItem value="2" className="text-xs">
                    2 hops
                  </SelectItem>
                  <SelectItem value="3" className="text-xs">
                    3 hops
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => navigate(diagramHref(db))}>
                <X /> Show all
              </Button>
            </>
          ) : (
            schemas.length > 1 && (
              <Select value={schema} onValueChange={setSchema}>
                <SelectTrigger size="sm" className="h-8 w-auto text-xs" aria-label="Schema">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="*" className="text-xs">
                    All schemas
                  </SelectItem>
                  {schemas.map((s) => (
                    <SelectItem key={s} value={s} className="font-mono text-xs">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          )}
          <div
            className="inline-flex h-8 overflow-hidden rounded-md border text-xs"
            role="group"
            aria-label="Columns to show"
          >
            {(['keys', 'all'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={columnMode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'px-2.5 transition-colors',
                  columnMode === m
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {m === 'keys' ? 'Key columns' : 'All columns'}
              </button>
            ))}
          </div>
          {Object.keys(moved).length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => saveMoved({})}
              title="Put every table back where the automatic layout placed it"
            >
              <RotateCcw /> Reset layout
            </Button>
          )}
          <Button
            variant="outline"
            size="icon-sm"
            className="size-8"
            aria-label="Fit to screen"
            title="Fit to screen"
            onClick={() => void flow.fitView({ padding: 0.08, duration: 300 })}
          >
            <Maximize />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs">
                <Download /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => void exportImage('png')}>PNG image</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportImage('svg')}>SVG (vector)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Panel>

        <Panel
          position="bottom-center"
          className="!mb-3 hidden items-center gap-4 rounded-lg border bg-background/95 px-3 py-1.5 text-[11px] whitespace-nowrap text-muted-foreground backdrop-blur xl:flex"
        >
          <span className="flex items-center gap-1.5">
            <KeyRound className="size-3 text-warning" /> primary key
          </span>
          <span className="flex items-center gap-1.5">
            <Link2 className="size-3 text-chart-data" /> foreign key
          </span>
          <span className="flex items-center gap-1.5">
            <svg viewBox="0 0 24 8" className="h-2 w-6" aria-hidden="true">
              <path d="M6 4h18" stroke="currentColor" strokeWidth="1.5" />
              <path d="M0 4l7-4v8z" fill="currentColor" />
            </svg>
            referenced table
          </span>
          <span>Click a table to trace its links. Drag to move, double-click to open.</span>
        </Panel>

        <Panel position="top-right" className="!m-3 hidden max-w-sm flex-col items-end gap-1.5 lg:flex">
          <div className="flex items-center gap-1.5 rounded-lg border bg-background/95 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
            <Network className="size-3.5" />
            {laid!.boxes.length} table{laid!.boxes.length === 1 ? '' : 's'} · {laid!.links.length} relation
            {laid!.links.length === 1 ? '' : 's'} shown
          </div>
          {(laid!.hiddenLinks > 0 || showHubs) && hubs.size > 0 && (
            <div className="rounded-lg border bg-background/95 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
              {showHubs ? (
                <>
                  Showing every link, including to {[...hubs.keys()].map((h) => h.replace(/^public\./, '')).join(', ')}.
                </>
              ) : (
                <>
                  Hiding {laid!.hiddenLinks} links to{' '}
                  <span className="font-mono text-foreground">
                    {[...hidden].map((h) => h.replace(/^public\./, '')).join(', ')}
                  </span>
                  , which almost every table references. Click one to see its links.
                </>
              )}{' '}
              <button
                type="button"
                className="font-medium text-foreground underline-offset-2 hover:underline"
                onClick={() => setShowHubs((v) => !v)}
              >
                {showHubs ? 'Hide them' : 'Show them'}
              </button>
            </div>
          )}
        </Panel>
      </ReactFlow>
    </div>
  );
}
