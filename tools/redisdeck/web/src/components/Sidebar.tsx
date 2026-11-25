import { KeyRound, Server, SquareTerminal, type LucideIcon } from 'lucide-react';
import type { ServerInfo } from '@shared/types';
import { cn } from '@deck/ui/lib/utils';
import { formatBytes, formatNumber } from '@/lib/format';
import { consoleHref, keysHref, serverHref, type Route } from '@/lib/router';

function NavLink({
  href,
  active,
  icon: Icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-foreground',
        active && 'bg-sidebar-accent font-medium text-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{children}</span>
    </a>
  );
}

export function SidebarNav({ route, info }: { route: Exclude<Route, { view: 'root' }>; info?: ServerInfo }) {
  const used = info?.keyspace ?? [];
  return (
    <nav className="flex h-full flex-col gap-6 p-3" aria-label="Main">
      <div className="space-y-0.5">
        <NavLink href={keysHref(route.db)} active={route.view === 'keys'} icon={KeyRound}>
          Keys
        </NavLink>
        <NavLink href={consoleHref(route.db)} active={route.view === 'console'} icon={SquareTerminal}>
          Console
        </NavLink>
        <NavLink href={serverHref(route.db)} active={route.view === 'server'} icon={Server}>
          Server
        </NavLink>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">Databases in use</div>
        {used.length === 0 && <p className="px-2 text-xs text-muted-foreground">Every database is empty.</p>}
        <div className="space-y-0.5">
          {used.map((d) => (
            <a
              key={d.index}
              href={keysHref(d.index)}
              aria-current={d.index === route.db ? 'true' : undefined}
              className={cn(
                'flex h-8 items-center gap-2 rounded-md px-2 font-mono text-[12.5px] text-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-foreground',
                d.index === route.db && 'bg-sidebar-accent text-foreground',
              )}
            >
              db{d.index}
              <span className="ml-auto font-sans text-xs text-muted-foreground tabular-nums">
                {formatNumber(d.keys)}
              </span>
            </a>
          ))}
        </div>
      </div>

      {info && (
        <div className="space-y-1 border-t px-2 pt-3 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Memory</span>
            <span className="text-foreground tabular-nums">{formatBytes(info.usedMemory)}</span>
          </div>
          <div className="flex justify-between">
            <span>{info.product === 'redis' ? 'Redis' : info.product}</span>
            <span className="text-foreground tabular-nums">{info.version}</span>
          </div>
        </div>
      )}
    </nav>
  );
}
