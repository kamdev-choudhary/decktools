import { useMemo, useSyncExternalStore } from 'react';

/** Hash routes keep the UI path-independent, so it works under any proxy prefix. */
export type Route = { view: 'home' } | { view: 'sql' } | { view: 'table'; schema: string; table: string };

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parseRoute(hash: string): Route {
  const [head, schema, table] = hash.replace(/^#\/?/, '').split('/').map(decode);
  if (head === 'sql') return { view: 'sql' };
  if (head === 't' && schema && table) return { view: 'table', schema, table };
  return { view: 'home' };
}

export const tableHref = (schema: string, table: string) =>
  `#/t/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`;

export const sqlHref = '#/sql';

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return useMemo(() => parseRoute(hash), [hash]);
}
