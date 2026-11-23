import { useMemo, useState } from 'react';
import { REL_KIND_LABEL, type TableRef } from '@shared/types';
import { useTables } from '../api/hooks';
import { sqlHref, tableHref, type Route } from '../lib/router';
import { ErrorBox, Spinner } from './ErrorBox';

const KIND_ICON: Record<TableRef['kind'], string> = { r: 'T', p: 'P', v: 'V', m: 'M', f: 'F' };

export function Sidebar({ route }: { route: Route }) {
  const tables = useTables();
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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

  const activeTable = route.view === 'table' ? `${route.schema}.${route.table}` : null;

  return (
    <aside className="sidebar">
      <a className={`side-sql ${route.view === 'sql' ? 'active' : ''}`} href={sqlHref}>
        <span>›_</span> SQL editor
      </a>
      <input
        className="input"
        type="search"
        placeholder="Filter tables…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      <nav className="tree" aria-label="Tables">
        {tables.isPending && (
          <div className="tree-empty">
            <Spinner /> Loading…
          </div>
        )}
        {tables.isError && <ErrorBox error={tables.error} />}
        {tables.isSuccess && !groups.length && <div className="tree-empty">{filter ? 'No matches' : 'No tables yet'}</div>}
        {groups.map(([schema, items]) => {
          const open = !!filter || !collapsed.has(schema);
          return (
            <div key={schema} className="schema">
              <button className={`schema-head ${open ? 'open' : ''}`} onClick={() => toggle(schema)} aria-expanded={open}>
                <span className="label">{schema}</span>
                <span className="count">{items.length}</span>
              </button>
              {open &&
                items.map((t) => (
                  <a
                    key={t.name}
                    href={tableHref(t.schema, t.name)}
                    className={`tbl ${activeTable === `${t.schema}.${t.name}` ? 'active' : ''}`}
                    title={`${t.schema}.${t.name} (${REL_KIND_LABEL[t.kind]})`}
                  >
                    <span className="k">{KIND_ICON[t.kind]}</span>
                    {t.name}
                  </a>
                ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
