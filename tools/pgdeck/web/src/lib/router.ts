import { useMemo, useSyncExternalStore } from 'react';
import type { ObjectKind } from '@shared/types';

const OBJECT_KINDS: ObjectKind[] = ['function', 'trigger', 'sequence', 'extension'];

/**
 * Hash routes keep the UI path-independent (works under any proxy prefix) and
 * put the selected database in the URL so refresh and bookmarks keep it.
 *
 *   #/                         → pick the default database
 *   #/<db>                     → database overview
 *   #/<db>/sql                 → SQL editor
 *   #/<db>/import              → import data from files
 *   #/<db>/export              → export tables / back up the database
 *   #/<db>/diagram?focus=s.t   → ER diagram, optionally centred on one table
 *   #/<db>/obj/<kind>/<oid>    → function / trigger / sequence / extension
 *   #/<db>/roles               → roles on the server
 *   #/<db>/roles/<name>        → one role: attributes, memberships, privileges in <db>
 *   #/<db>/t/<schema>/<table>  → table
 *   …/<table>?col=value        → table pre-filtered with col = value (used by FK links)
 */
export type Route =
  | { view: 'root' }
  | { view: 'home'; db: string }
  | { view: 'sql'; db: string }
  | { view: 'import'; db: string }
  | { view: 'export'; db: string }
  | { view: 'diagram'; db: string; focus: string | null }
  | { view: 'object'; db: string; kind: ObjectKind; oid: number }
  | { view: 'roles'; db: string }
  | { view: 'role'; db: string; name: string }
  | { view: 'table'; db: string; schema: string; table: string; eq: Record<string, string> };

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const q = raw.indexOf('?');
  const path = q >= 0 ? raw.slice(0, q) : raw;
  const query = q >= 0 ? raw.slice(q + 1) : '';
  const [db, section, schema, table] = path.split('/').map(decode);
  if (!db) return { view: 'root' };
  if (section === 'sql') return { view: 'sql', db };
  if (section === 'import') return { view: 'import', db };
  if (section === 'export') return { view: 'export', db };
  if (section === 'obj' && OBJECT_KINDS.includes(schema as ObjectKind) && /^\d+$/.test(table ?? '')) {
    return { view: 'object', db, kind: schema as ObjectKind, oid: Number(table) };
  }
  if (section === 'roles') return schema ? { view: 'role', db, name: schema } : { view: 'roles', db };
  if (section === 'diagram') return { view: 'diagram', db, focus: new URLSearchParams(query).get('focus') };
  if (section === 't' && schema && table) {
    return { view: 'table', db, schema, table, eq: Object.fromEntries(new URLSearchParams(query)) };
  }
  return { view: 'home', db };
}

const enc = encodeURIComponent;
export const dbHref = (db: string) => `#/${enc(db)}`;
export const sqlHref = (db: string) => `#/${enc(db)}/sql`;
export const importHref = (db: string) => `#/${enc(db)}/import`;
export const exportHref = (db: string) => `#/${enc(db)}/export`;
export const objectHref = (db: string, kind: ObjectKind, oid: number) => `#/${enc(db)}/obj/${kind}/${oid}`;
export const diagramHref = (db: string, focus?: string | null) =>
  `#/${enc(db)}/diagram${focus ? `?${new URLSearchParams({ focus })}` : ''}`;
export const rolesHref = (db: string) => `#/${enc(db)}/roles`;
export const roleHref = (db: string, name: string) => `#/${enc(db)}/roles/${enc(name)}`;
export const tableHref = (db: string, schema: string, table: string, eq?: Record<string, string>) => {
  const qs = eq && Object.keys(eq).length ? `?${new URLSearchParams(eq)}` : '';
  return `#/${enc(db)}/t/${enc(schema)}/${enc(table)}${qs}`;
};

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return useMemo(() => parseRoute(hash), [hash]);
}

export const navigate = (href: string, replace = false) => {
  if (replace) location.replace(href);
  else location.hash = href.slice(1);
};
