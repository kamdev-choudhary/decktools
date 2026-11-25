import { useEffect, useState } from 'react';
import type { SessionInfo } from '@shared/types';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@deck/ui/components/sheet';
import { storage } from '@deck/ui/lib/storage';
import { cn } from '@deck/ui/lib/utils';
import { useServer, useSession } from '@/api/hooks';
import { CenteredSpinner, ErrorAlert } from '@/components/feedback';
import { Header } from '@/components/Header';
import { SidebarNav } from '@/components/Sidebar';
import { keysHref, navigate, useRoute, type Route } from '@/lib/router';
import { ConsoleView } from '@/views/ConsoleView';
import { KeysView } from '@/views/KeysView';
import { LoginView } from '@/views/LoginView';
import { ServerView } from '@/views/ServerView';

const SIDEBAR_KEY = 'redisdeck.sidebar';

export function App() {
  const session = useSession();
  if (session.isPending) return <CenteredSpinner />;
  if (session.isError)
    return <ErrorAlert error={session.error} title="Cannot reach redisdeck" className="m-6 w-auto" />;
  if (!session.data.authenticated) return <LoginView />;
  return <Workspace session={session.data} />;
}

function Workspace({ session }: { session: SessionInfo }) {
  const route = useRoute();
  const server = useServer();
  const defaultDb = server.data?.defaultDb;

  // Open the database from the connection URL when the address names none.
  useEffect(() => {
    if (route.view === 'root' && defaultDb !== undefined) navigate(keysHref(defaultDb), true);
  }, [route.view, defaultDb]);

  if (server.isError) return <ErrorAlert error={server.error} title="Cannot reach Redis" className="m-6 w-auto" />;
  if (route.view === 'root') return <CenteredSpinner />;
  return <Shell route={route} session={session} />;
}

function Shell({ route, session }: { route: Exclude<Route, { view: 'root' }>; session: SessionInfo }) {
  const server = useServer();
  const [drawer, setDrawer] = useState(false); // mobile
  const [collapsed, setCollapsed] = useState(() => storage.get(SIDEBAR_KEY) === 'collapsed'); // desktop

  // Close the mobile drawer on navigation.
  const [drawerFor, setDrawerFor] = useState(route);
  if (drawerFor !== route) {
    setDrawerFor(route);
    setDrawer(false);
  }

  useEffect(() => {
    const where = route.view === 'console' ? 'Console' : route.view === 'server' ? 'Server' : `db${route.db}`;
    document.title = `${where} · redisdeck`;
  }, [route]);

  const toggleSidebar = () => {
    if (window.matchMedia('(min-width: 768px)').matches) {
      setCollapsed((c) => {
        storage.set(SIDEBAR_KEY, c ? 'open' : 'collapsed');
        return !c;
      });
    } else setDrawer(true);
  };

  const content =
    route.view === 'console' ? (
      <ConsoleView key={route.db} db={route.db} />
    ) : route.view === 'server' ? (
      <ServerView />
    ) : (
      <KeysView key={route.db} db={route.db} selected={route.key} />
    );

  return (
    <div className="flex h-dvh flex-col">
      <Header route={route} session={session} info={server.data} onToggleSidebar={toggleSidebar} />
      <div className="flex min-h-0 flex-1">
        <aside className={cn('hidden w-56 shrink-0 border-r bg-sidebar', !collapsed && 'md:block')}>
          <SidebarNav route={route} info={server.data} />
        </aside>
        <Sheet open={drawer} onOpenChange={setDrawer}>
          <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription>Keys, console and server</SheetDescription>
            </SheetHeader>
            <div className="h-full pt-10">
              <SidebarNav route={route} info={server.data} />
            </div>
          </SheetContent>
        </Sheet>
        <main className="flex min-w-0 flex-1 flex-col">{content}</main>
      </div>
    </div>
  );
}
