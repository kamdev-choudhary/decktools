import { useMemo, useSyncExternalStore } from 'react';

/**
 * Hash routes keep the UI path-independent (works under any proxy prefix) and
 * put the selected database in the URL so refresh and bookmarks keep it.
 *
 *   #/                         → pick the default database
 *   #/<db>                     → database overview
 *   #/<db>/sql                 → SQL editor
 *   #/<db>/import              → import data from files
 *   #/<db>/export              → export tables / back up the database
 *   #/<db>/t/<schema>/<table>  → table
 *   …/<table>?col=value        → table pre-filtered with col = value (used by FK links)
 */
export type Route =
  | { view: 'root' }
  | { view: 'home'; db: string }
  | { view: 'sql'; db: string }
  | { view: 'import'; db: string }
  | { view: 'export'; db: string }
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
