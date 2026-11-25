import { useMemo, useSyncExternalStore } from 'react';

/**
 * Hash routes keep the UI path-independent (works under any proxy prefix):
 *
 *   #/                 → default database
 *   #/<db>             → key browser
 *   #/<db>/k/<id>      → key browser with a key open (id: the key's bytes, base64url)
 *   #/<db>/console     → command console
 *   #/<db>/server      → server overview
 */
export type Route =
  | { view: 'root' }
  | { view: 'keys'; db: number; key: string | null }
  | { view: 'console'; db: number }
  | { view: 'server'; db: number };

/** Standard base64 (API ids) ⇄ base64url without padding (URLs). */
export const toUrlId = (id: string) => id.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromUrlId = (s: string) => {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return b + '='.repeat((4 - (b.length % 4)) % 4);
};

export function parseRoute(hash: string): Route {
  const [dbPart, section, rest] = hash.replace(/^#\/?/, '').split('?')[0]!.split('/');
  if (!dbPart || !/^\d+$/.test(dbPart)) return { view: 'root' };
  const db = Number(dbPart);
  if (section === 'console') return { view: 'console', db };
  if (section === 'server') return { view: 'server', db };
  if (section === 'k' && rest) return { view: 'keys', db, key: fromUrlId(rest) };
  return { view: 'keys', db, key: null };
}

export const keysHref = (db: number) => `#/${db}`;
export const keyHref = (db: number, id: string) => `#/${db}/k/${toUrlId(id)}`;
export const consoleHref = (db: number) => `#/${db}/console`;
export const serverHref = (db: number) => `#/${db}/server`;

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
