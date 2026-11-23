import { PanelLeft } from 'lucide-react';
import type { DbInfo, SessionInfo } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { dbHref, type Route } from '@/lib/router';
import { DatabaseSwitcher } from './DatabaseSwitcher';
import { Slash } from './feedback';
import { Logo } from './Logo';
import { TruncatedText } from './TruncatedText';
import { UserMenu } from './UserMenu';

interface HeaderProps {
  db: string;
  route: Route;
  session: SessionInfo;
  info?: DbInfo;
  onToggleSidebar: () => void;
}

export function Header({ db, route, session, info, onToggleSidebar }: HeaderProps) {
  const crumb = route.view === 'table' ? route.table : route.view === 'sql' ? 'SQL Editor' : null;

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
      <a href={dbHref(db)} className="flex items-center gap-2 rounded-md px-1 font-semibold tracking-tight">
        <Logo />
        <span className="hidden sm:inline">pgdeck</span>
      </a>
      <Slash />
      <DatabaseSwitcher current={db} />
      {crumb && (
        <>
          <Slash />
          <TruncatedText
            text={crumb}
            tooltip={route.view === 'table' ? `${route.schema}.${route.table}` : crumb}
            side="bottom"
            className="hidden max-w-[40vw] px-2 text-sm font-medium sm:block"
          />
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
