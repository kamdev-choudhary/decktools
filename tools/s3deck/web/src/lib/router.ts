import { useSyncExternalStore } from 'react';

/**
 * The location lives in the query string (?b=bucket&p=folder/), so the page itself is
 * always served from the app root. That keeps relative asset and API URLs working at a
 * domain root and under any --base-path, and links/bookmarks keep the bucket and folder.
 */
export interface Route {
  bucket: string | null;
  prefix: string;
  /** Search the whole bucket by key prefix. */
  search: string;
  /** "settings" needs a bucket; the others are app-wide pages. */
  view: 'browse' | 'settings' | 'sync' | 'activity' | 'users';
  /** Object open in the side panel. */
  object: string | null;
}

const EVENT = 's3deck:navigate';
const VIEWS = new Set(['settings', 'sync', 'activity', 'users']);

let cachedSearch: string | null = null;
let cachedRoute: Route;

function parse(search: string): Route {
  const q = new URLSearchParams(search);
  return {
    bucket: q.get('b') || null,
    prefix: q.get('p') ?? '',
    search: q.get('q') ?? '',
    view: VIEWS.has(q.get('view') ?? '') ? (q.get('view') as Route['view']) : 'browse',
    object: q.get('o') || null,
  };
}

function snapshot(): Route {
  if (cachedSearch !== location.search) {
    cachedSearch = location.search;
    cachedRoute = parse(location.search);
  }
  return cachedRoute;
}

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(EVENT, cb);
  };
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot);
}

export function hrefFor(route: Partial<Route>): string {
  const q = new URLSearchParams();
  if (route.bucket) q.set('b', route.bucket);
  if (route.prefix) q.set('p', route.prefix);
  if (route.search) q.set('q', route.search);
  if (route.view && route.view !== 'browse') q.set('view', route.view);
  if (route.object) q.set('o', route.object);
  const s = q.toString();
  return s ? `?${s}` : location.pathname;
}

export function navigate(route: Partial<Route>, opts: { replace?: boolean } = {}) {
  const href = hrefFor(route);
  if (href === location.search || (href === location.pathname && !location.search)) return;
  history[opts.replace ? 'replaceState' : 'pushState'](null, '', href);
  window.dispatchEvent(new Event(EVENT));
}

/** Updates part of the current route. */
export function patchRoute(patch: Partial<Route>, opts?: { replace?: boolean }) {
  navigate({ ...snapshot(), ...patch }, opts);
}

export function parentPrefix(prefix: string): string {
  const trimmed = prefix.replace(/\/$/, '');
  const i = trimmed.lastIndexOf('/');
  return i === -1 ? '' : trimmed.slice(0, i + 1);
}
