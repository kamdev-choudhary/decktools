import { PanelLeft } from 'lucide-react';
import type { DbInfo, SessionInfo } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { dbHref, type Route } from '@/lib/router';
import { DatabaseSwitcher } from './DatabaseSwitcher';
import { Slash } from './feedback';
import { Logo } from './Logo';
import { UserMenu } from './UserMenu';

interface HeaderProps {
  db: string;
  route: Route;
  session: SessionInfo;
  info?: DbInfo;
  onOpenSidebar: () => void;
}

export function Header({ db, route, session, info, onOpenSidebar }: HeaderProps) {
  const crumb = route.view === 'table' ? route.table : route.view === 'sql' ? 'SQL Editor' : null;

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b bg-background px-3 md:px-4">
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onOpenSidebar} aria-label="Open navigation">
        <PanelLeft />
      </Button>
      <a href={dbHref(db)} className="flex items-center gap-2 rounded-md px-1 font-semibold tracking-tight">
        <Logo />
        <span className="hidden sm:inline">pgdeck</span>
      </a>
      <Slash />
      <DatabaseSwitcher current={db} />
      {crumb && (
        <>
          <Slash />
          <span className="hidden truncate px-2 text-sm font-medium sm:inline">{crumb}</span>
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
