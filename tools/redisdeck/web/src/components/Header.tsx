import { Check, ChevronsUpDown, Database, PanelLeft } from 'lucide-react';
import { useState } from 'react';
import type { ServerInfo, SessionInfo } from '@shared/types';
import { Badge } from '@deck/ui/components/badge';
import { Button } from '@deck/ui/components/button';
import { Command, CommandGroup, CommandItem, CommandList } from '@deck/ui/components/command';
import { Popover, PopoverContent, PopoverTrigger } from '@deck/ui/components/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@deck/ui/components/tooltip';
import { cn } from '@deck/ui/lib/utils';
import { formatNumber } from '@/lib/format';
import { consoleHref, keysHref, navigate, serverHref, type Route } from '@/lib/router';
import { Slash } from './feedback';
import { Logo } from './Logo';
import { UserMenu } from './UserMenu';

/** Logical database picker: every index the server has, with key counts. */
function DatabaseSwitcher({ route, info }: { route: Exclude<Route, { view: 'root' }>; info?: ServerInfo }) {
  const [open, setOpen] = useState(false);
  const counts = new Map(info?.keyspace.map((d) => [d.index, d.keys]));
  const total = info?.databases ?? 16;
  const go = (db: number) =>
    navigate(route.view === 'console' ? consoleHref(db) : route.view === 'server' ? serverHref(db) : keysHref(db));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" role="combobox" aria-expanded={open} className="gap-2 px-2 font-medium">
          <Database className="text-muted-foreground" />
          db{route.db}
          <span className="text-xs font-normal text-muted-foreground tabular-nums">{formatNumber(counts.get(route.db) ?? 0)} keys</span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandList className="max-h-80">
            <CommandGroup heading={`Databases · ${total}`}>
              {Array.from({ length: total }, (_, db) => (
                <CommandItem
                  key={db}
                  value={`db${db}`}
                  onSelect={() => {
                    setOpen(false);
                    go(db);
                  }}
                >
                  <Check className={cn('size-4', db === route.db ? 'opacity-100' : 'opacity-0')} />
                  <span className={cn('font-mono', !counts.get(db) && 'text-muted-foreground')}>db{db}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">{counts.get(db) ? formatNumber(counts.get(db)!) : 'empty'}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const CRUMB = { console: 'Console', server: 'Server' } as const;

export function Header({ route, session, info, onToggleSidebar }: { route: Exclude<Route, { view: 'root' }>; session: SessionInfo; info?: ServerInfo; onToggleSidebar: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b bg-background px-3 md:px-4">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={onToggleSidebar} aria-label="Toggle sidebar">
            <PanelLeft />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Toggle sidebar</TooltipContent>
      </Tooltip>
      <a href={keysHref(route.db)} className="flex items-center gap-2 rounded-md px-1 font-semibold tracking-tight">
        <Logo />
        <span className="hidden sm:inline">redisdeck</span>
      </a>
      <Slash />
      <DatabaseSwitcher route={route} info={info} />
      {route.view !== 'keys' && (
        <>
          <Slash />
          <span className="hidden px-2 text-sm font-medium sm:block">{CRUMB[route.view]}</span>
        </>
      )}
      <div className="flex-1" />
      {info?.readonly && (
        <Badge variant="outline" className="mr-2 border-warning/40 text-warning">
          Read-only
        </Badge>
      )}
      <UserMenu session={session} info={info} />
    </header>
  );
}
