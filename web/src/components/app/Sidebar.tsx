import { ChevronRight, Eye, FileDown, FileUp, Layers, LayoutGrid, Network, Plus, Search, SquareTerminal, Table2, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { REL_KIND_LABEL, type RelKind, type TableRef } from '@shared/types';
import { useInfo, useTables } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CreateTableDialog } from './CreateTableDialog';
import { ObjectsNav } from './ObjectsNav';
import { Input } from '@/components/ui/input';
import { dbHref, diagramHref, exportHref, importHref, sqlHref, tableHref, type Route } from '@/lib/router';
import { cn } from '@/lib/utils';
import { ErrorAlert, Spinner } from './feedback';
import { TableActionsMenu } from './TableActionsMenu';
import { TruncatedText } from './TruncatedText';

const KIND_ICON: Record<RelKind, LucideIcon> = { r: Table2, p: Table2, f: Table2, v: Eye, m: Layers };

function NavLink({ href, active, icon: Icon, children }: { href: string; active: boolean; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
        active && 'bg-sidebar-accent font-medium text-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{children}</span>
    </a>
  );
}

export function SidebarNav({ db, route }: { db: string; route: Route }) {
  const tables = useTables(db);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const readonly = useInfo(db).data?.readonly ?? true;

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const map = new Map<string, TableRef[]>();
    for (const t of tables.data ?? []) {
      if (needle && !`${t.schema}.${t.name}`.toLowerCase().includes(needle)) continue;
      const list = map.get(t.schema) ?? [];
      list.push(t);
      map.set(t.schema, list);
    }
    return [...map];
  }, [tables.data, filter]);

  const toggle = (schema: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(schema)) next.delete(schema);
      else next.add(schema);
      return next;
    });

  const active = route.view === 'table' ? `${route.schema}.${route.table}` : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-0.5 p-3 pb-2">
        <NavLink href={dbHref(db)} active={route.view === 'home'} icon={LayoutGrid}>
          Overview
        </NavLink>
        <NavLink href={sqlHref(db)} active={route.view === 'sql'} icon={SquareTerminal}>
          SQL Editor
        </NavLink>
        <NavLink href={diagramHref(db)} active={route.view === 'diagram'} icon={Network}>
          ER diagram
        </NavLink>
        <NavLink href={importHref(db)} active={route.view === 'import'} icon={FileUp}>
          Import data
        </NavLink>
        <NavLink href={exportHref(db)} active={route.view === 'export'} icon={FileDown}>
          Export data
        </NavLink>
      </div>

      <div className="flex gap-1.5 px-3 pb-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search tables…"
            className="h-8 pl-8 text-[13px]"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        {!readonly && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="New table" onClick={() => setCreating(true)} className="size-8">
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">New table</TooltipContent>
          </Tooltip>
        )}
      </div>
      {creating && <CreateTableDialog db={db} defaultSchema={route.view === 'table' ? route.schema : 'public'} onClose={() => setCreating(false)} />}

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <nav className="px-3 pb-4" aria-label="Tables">
          {tables.isPending && (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
              <Spinner /> Loading tables…
            </div>
          )}
          {tables.isError && <ErrorAlert error={tables.error} className="mt-2" />}
          {tables.isSuccess && !groups.length && (
            <p className="px-2 py-3 text-sm text-muted-foreground">{filter ? 'No matching tables' : 'No tables in this database'}</p>
          )}

          {groups.map(([schema, items]) => {
            const open = !!filter || !collapsed.has(schema);
            return (
              <div key={schema} className="mt-2">
                <button
                  type="button"
                  onClick={() => toggle(schema)}
                  aria-expanded={open}
                  className="flex h-7 w-full items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
                  <TruncatedText text={schema} className="flex-1 text-left" />
                  <span className="tabular-nums">{items.length}</span>
                </button>
                {open && (
                  <div className="mt-0.5 space-y-px">
                    {items.map((t) => {
                      const Icon = KIND_ICON[t.kind];
                      const isActive = active === `${t.schema}.${t.name}`;
                      return (
                        <div
                          key={t.name}
                          className={cn(
                            'group/item flex h-8 min-w-0 items-center rounded-md pr-1 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
                            isActive && 'bg-sidebar-accent font-medium text-foreground',
                          )}
                        >
                          <a
                            href={tableHref(db, t.schema, t.name)}
                            aria-current={isActive ? 'page' : undefined}
                            className="flex h-full min-w-0 flex-1 items-center gap-2 pl-6"
                          >
                            <Icon className="size-4 shrink-0 opacity-70" />
                            <TruncatedText
                              text={t.name}
                              side="right"
                              tooltip={
                                <>
                                  <span className="font-mono">
                                    {t.schema}.{t.name}
                                  </span>
                                  <span className="opacity-60"> · {REL_KIND_LABEL[t.kind]}</span>
                                </>
                              }
                            />
                          </a>
                          <TableActionsMenu db={db} schema={t.schema} table={t.name} kind={t.kind} variant="sidebar" className="shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {tables.isSuccess && <ObjectsNav db={db} filter={filter} route={route} />}
        </nav>
      </div>
    </div>
  );
}
