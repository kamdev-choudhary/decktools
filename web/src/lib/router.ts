import { useMemo, useSyncExternalStore } from 'react';

/**
 * Hash routes keep the UI path-independent (works under any proxy prefix) and
 * put the selected database in the URL so refresh and bookmarks keep it.
 *
 *   #/                         → pick the default database
 *   #/<db>                     → database overview
 *   #/<db>/sql                 → SQL editor
 *   #/<db>/t/<schema>/<table>  → table
 */
export type Route =
  | { view: 'root' }
  | { view: 'home'; db: string }
  | { view: 'sql'; db: string }
  | { view: 'table'; db: string; schema: string; table: string };

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parseRoute(hash: string): Route {
  const [db, section, schema, table] = hash.replace(/^#\/?/, '').split('/').map(decode);
  if (!db) return { view: 'root' };
  if (section === 'sql') return { view: 'sql', db };
  if (section === 't' && schema && table) return { view: 'table', db, schema, table };
  return { view: 'home', db };
}

const enc = encodeURIComponent;
export const dbHref = (db: string) => `#/${enc(db)}`;
export const sqlHref = (db: string) => `#/${enc(db)}/sql`;
export const tableHref = (db: string, schema: string, table: string) => `#/${enc(db)}/t/${enc(schema)}/${enc(table)}`;

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
