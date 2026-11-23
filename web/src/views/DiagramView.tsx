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
  type NodeProps,
} from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';
import { Download, ExternalLink, KeyRound, Link2, Maximize, Network, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { keys } from '@/api/hooks';
import { Combobox } from '@/components/app/Combobox';
import { CenteredSpinner, ErrorAlert, errorMessage } from '@/components/app/feedback';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { findHubs, HEADER_H, layoutDiagram, neighbourhood, ROW_H, tableId, type ColumnMode, type TableBox } from '@/lib/er-layout';
import { diagramHref, navigate, tableHref } from '@/lib/router';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

type TableNodeData = { box: TableBox; state: 'normal' | 'active' | 'related' | 'dim'; db: string };
type TableNode = Node<TableNodeData, 'table'>;

const compact = (n: number) => (n < 0 ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

/** One table: header plus its (key) columns, with a handle on each side of every column. */
const TableCard = memo(function TableCard({ data }: NodeProps<TableNode>) {
  const { box, state, db } = data;
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
          <div key={c.name} className="relative flex items-center gap-1.5 px-3 text-xs" style={{ height: ROW_H }}>
            <Handle type="target" position={Position.Left} id={`t:${c.name}`} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
            <span className="flex w-3.5 shrink-0 justify-center">
              {c.pk ? <KeyRound className="size-3 text-warning" aria-label="Primary key" /> : c.fk ? <Link2 className="size-3 text-chart-data" aria-label="Foreign key" /> : null}
            </span>
            <span className={cn('min-w-0 flex-1 truncate font-mono', c.pk && 'font-medium')}>{c.name}</span>
            <span className="max-w-[45%] shrink-0 truncate font-mono text-[10px] text-muted-foreground">
              {c.type}
            </span>
            <Handle type="source" position={Position.Right} id={`s:${c.name}`} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
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

  useEffect(() => setSelected(focus), [focus]);

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

  // Links to hubs are hidden unless asked for, or the hub itself is focused or selected.
  const hubs = useMemo(() => (g ? findHubs(g, visible) : new Map<string, number>()), [g, visible]);
  const hidden = useMemo(
    () => (showHubs ? new Set<string>() : new Set([...hubs.keys()].filter((h) => h !== focus && h !== selected))),
    [showHubs, hubs, focus, selected],
  );
  const laid = useMemo(() => (g ? layoutDiagram(g, visible, columnMode, hidden) : null), [g, visible, columnMode, hidden]);

  // Highlight the selected table and its direct neighbours.
  const related = useMemo(() => {
    const s = new Set<string>();
    if (!selected || !laid) return s;
    for (const l of laid.links) {
      if (l.source === selected) s.add(l.target);
      if (l.target === selected) s.add(l.source);
    }
    return s;
  }, [selected, laid]);

  const nodes = useMemo<TableNode[]>(
    () =>
      laid?.boxes.map((b) => ({
        id: b.id,
        type: 'table',
        position: { x: b.x, y: b.y },
        width: b.width,
        height: b.height,
        data: {
          box: b,
          db,
          state: !selected ? 'normal' : b.id === selected ? 'active' : related.has(b.id) ? 'related' : 'dim',
        },
      })) ?? [],
    [laid, selected, related, db],
  );

  const edges = useMemo<Edge[]>(
    () =>
      laid?.links.map((l) => {
        const on = !!selected && (l.source === selected || l.target === selected);
        return {
          id: l.id,
          source: l.source,
          target: l.target,
          sourceHandle: `s:${l.sourceColumn}`,
          targetHandle: `t:${l.targetColumn}`,
          type: 'smoothstep',
          zIndex: on ? 10 : 0,
          style: { stroke: on ? 'var(--chart-data)' : 'var(--diagram-edge)', strokeWidth: on ? 2 : 1.25, opacity: selected && !on ? 0.2 : 1 },
          ariaLabel: `${l.fk.schema}.${l.fk.table}(${l.fk.columns.join(', ')}) references ${l.fk.refSchema}.${l.fk.refTable}(${l.fk.refColumns.join(', ')})`,
        };
      }) ?? [],
    [laid, selected],
  );

  // Re-fit when the set of tables changes; centre on the focused table when there is one.
  useEffect(() => {
    if (!nodes.length) return;
    const t = setTimeout(() => {
      if (focus && nodes.some((n) => n.id === focus) && nodes.length > 12) void flow.fitView({ nodes: [{ id: focus }], maxZoom: 1, duration: 300 });
      else void flow.fitView({ padding: 0.08, duration: 300 });
    }, 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laid]);

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
        style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
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
    return <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">This database has no tables yet.</div>;
  }

  const tableOptions = g!.tables.map((t) => ({ value: tableId(t.schema, t.name), label: t.schema === 'public' ? t.name : `${t.schema}.${t.name}`, hint: t.schema === 'public' ? undefined : t.schema }));

  return (
    <div className="pgdeck-flow relative min-h-0 flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        forceColorMode={resolved}
        minZoom={0.05}
        maxZoom={2}
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
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable position="bottom-right" nodeBorderRadius={6} className="!hidden md:!block" />

        <Panel position="top-left" className="!m-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-2 backdrop-blur">
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
                  <SelectItem value="1" className="text-xs">Direct relations</SelectItem>
                  <SelectItem value="2" className="text-xs">2 hops</SelectItem>
                  <SelectItem value="3" className="text-xs">3 hops</SelectItem>
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
                  <SelectItem value="*" className="text-xs">All schemas</SelectItem>
                  {schemas.map((s) => (
                    <SelectItem key={s} value={s} className="font-mono text-xs">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          )}
          <div className="inline-flex h-8 overflow-hidden rounded-md border text-xs" role="group" aria-label="Columns to show">
            {(['keys', 'all'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={columnMode === m}
                onClick={() => setMode(m)}
                className={cn('px-2.5 transition-colors', columnMode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
              >
                {m === 'keys' ? 'Key columns' : 'All columns'}
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon-sm" className="size-8" aria-label="Fit to screen" title="Fit to screen" onClick={() => void flow.fitView({ padding: 0.08, duration: 300 })}>
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

        <Panel position="top-right" className="!m-3 hidden max-w-sm flex-col items-end gap-1.5 lg:flex">
          <div className="flex items-center gap-1.5 rounded-lg border bg-background/95 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
            <Network className="size-3.5" />
            {laid!.boxes.length} table{laid!.boxes.length === 1 ? '' : 's'} · {laid!.links.length} relation{laid!.links.length === 1 ? '' : 's'} shown
          </div>
          {(laid!.hiddenLinks > 0 || showHubs) && hubs.size > 0 && (
            <div className="rounded-lg border bg-background/95 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
              {showHubs ? (
                <>Showing every link, including to {[...hubs.keys()].map((h) => h.replace(/^public\./, '')).join(', ')}.</>
              ) : (
                <>
                  Hiding {laid!.hiddenLinks} links to{' '}
                  <span className="font-mono text-foreground">{[...hidden].map((h) => h.replace(/^public\./, '')).join(', ')}</span>, which almost every table references. Click
                  one to see its links.
                </>
              )}{' '}
              <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => setShowHubs((v) => !v)}>
                {showHubs ? 'Hide them' : 'Show them'}
              </button>
            </div>
          )}
        </Panel>
      </ReactFlow>
    </div>
  );
}
