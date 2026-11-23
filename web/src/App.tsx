import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { SessionInfo } from '@shared/types';
import { useDatabases, useInfo, useSession } from '@/api/hooks';
import { CenteredSpinner, ErrorAlert } from '@/components/app/feedback';
import { Header } from '@/components/app/Header';
import { SidebarNav } from '@/components/app/Sidebar';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { dbHref, navigate, useRoute } from '@/lib/router';
import { storage } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { LoginView } from '@/views/LoginView';
import { OverviewView } from '@/views/OverviewView';
import { ExportView } from '@/views/ExportView';
import { ImportView } from '@/views/ImportView';
import { SqlView } from '@/views/SqlView';
import { TableView } from '@/views/TableView';

const SIDEBAR_KEY = 'pgdeck.sidebar';

export function App() {
  const session = useSession();

  if (session.isPending) return <CenteredSpinner />;
  if (session.isError) return <ErrorAlert error={session.error} title="Cannot reach pgdeck" className="m-6 w-auto" />;
  if (!session.data.authenticated) return <LoginView />;
  return <Workspace session={session.data} />;
}

function Workspace({ session }: { session: SessionInfo }) {
  const route = useRoute();
  const databases = useDatabases();

  // Go to the server's default database when the URL names none, or names one
  // that doesn't exist (a stale bookmark, a typo, or a database dropped since).
  const unknownDb =
    route.view !== 'root' && !!databases.data && !databases.data.databases.some((d) => d.name === route.db);

  useEffect(() => {
    if (!databases.data) return;
    if (route.view === 'root') navigate(dbHref(databases.data.default), true);
    else if (unknownDb) {
      toast.warning(`Database "${route.db}" not found`, { description: `Opened ${databases.data.default} instead.` });
      navigate(dbHref(databases.data.default), true);
    }
  }, [route, databases.data, unknownDb]);

  if (route.view === 'root' || unknownDb) {
    return databases.isError ? <ErrorAlert error={databases.error} className="m-6 w-auto" /> : <CenteredSpinner />;
  }
  return <Shell key={route.db} db={route.db} session={session} />;
}

function Shell({ db, session }: { db: string; session: SessionInfo }) {
  const route = useRoute();
  const info = useInfo(db);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(() => storage.get(SIDEBAR_KEY) === 'collapsed'); // desktop

  const toggleSidebar = () => {
    if (window.matchMedia('(min-width: 768px)').matches) {
      setCollapsed((c) => {
        storage.set(SIDEBAR_KEY, c ? 'open' : 'collapsed');
        return !c;
      });
    } else {
      setSidebarOpen(true);
    }
  };

  useEffect(() => setSidebarOpen(false), [route]);

  useEffect(() => {
    const where = route.view === 'table' ? route.table : route.view === 'sql' ? 'SQL' : route.view === 'import' ? 'Import' : route.view === 'export' ? 'Export' : db;
    document.title = `${where} · pgdeck`;
  }, [route, db]);

  let content: React.ReactNode;
  if (route.view === 'sql') content = <SqlView db={db} />;
  else if (route.view === 'import') content = <ImportView db={db} />;
  else if (route.view === 'export') content = <ExportView db={db} />;
  else if (route.view === 'table')
    content = (
      <TableView
        key={`${route.schema}.${route.table}?${new URLSearchParams(route.eq)}`}
        db={db}
        schema={route.schema}
        table={route.table}
        eq={route.eq}
        readonly={info.data?.readonly ?? false}
      />
    );
  else content = <OverviewView db={db} />;

  return (
    <div className="flex h-dvh flex-col">
      <Header db={db} route={route} session={session} info={info.data} onToggleSidebar={toggleSidebar} />
      <div className="flex min-h-0 flex-1">
        <aside className={cn('hidden w-64 shrink-0 border-r bg-sidebar', !collapsed && 'md:block')}>
          <SidebarNav db={db} route={route} />
        </aside>
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription>Tables in {db}</SheetDescription>
            </SheetHeader>
            <div className="h-full pt-10">
              <SidebarNav db={db} route={route} />
            </div>
          </SheetContent>
        </Sheet>
        <main className="flex min-w-0 flex-1 flex-col">
          {info.isError ? <ErrorAlert error={info.error} title={`Cannot open ${db}`} className="m-6 w-auto" /> : content}
        </main>
      </div>
    </div>
  );
}
