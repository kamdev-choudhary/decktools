import { useEffect, useState } from 'react';
import { useInfo } from './api/hooks';
import { ErrorBox } from './components/ErrorBox';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { useRoute } from './lib/router';
import { SqlView } from './views/SqlView';
import { TableView } from './views/TableView';
import { Welcome } from './views/Welcome';

export function App() {
  const route = useRoute();
  const info = useInfo();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close the mobile drawer after navigating.
  useEffect(() => setSidebarOpen(false), [route]);

  useEffect(() => {
    document.title = route.view === 'table' ? `${route.table} · pgdeck` : route.view === 'sql' ? 'SQL · pgdeck' : 'pgdeck';
  }, [route]);

  return (
    <div className={`app ${sidebarOpen ? 'side-open' : ''}`}>
      <Header info={info.data} onToggleSidebar={() => setSidebarOpen((o) => !o)} />
      <Sidebar route={route} />
      <main className="main">
        {info.isError ? (
          <ErrorBox error={info.error} />
        ) : route.view === 'sql' ? (
          <SqlView />
        ) : route.view === 'table' ? (
          <TableView
            key={`${route.schema}.${route.table}`}
            schema={route.schema}
            table={route.table}
            readonly={info.data?.readonly ?? false}
          />
        ) : (
          <Welcome info={info.data} />
        )}
      </main>
    </div>
  );
}
