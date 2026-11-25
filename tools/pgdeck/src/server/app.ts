import { createDeckApp } from '@deck/server';
import type { AuthConfig } from '@deck/config';
import type { DatabaseManager } from '../db/index.js';
import { mapError } from './middleware/errors.js';
import { apiRoutes } from './routes/api.js';

export type { AuthConfig } from '@deck/config';

/** Session cookie, CSRF header: part of the contract with existing browsers and the UI. */
export const SESSION_COOKIE = 'pgdeck_session';
export const CSRF_HEADER = 'x-pgdeck';

export interface AppOptions {
  manager: DatabaseManager;
  auth: AuthConfig | null;
  /** Prefix such as "/db" when a proxy forwards the path without stripping it. */
  basePath: string;
  /** Directory holding the built web UI. */
  webRoot: string;
}

// Exports are plain GET downloads (<a href download>), which can't send headers.
const isExport = (method: string, path: string) => method === 'GET' && /^\/api\/db\/[^/]+\/(export|dump)$/.test(path);

export function createApp({ manager, auth, basePath, webRoot }: AppOptions) {
  return createDeckApp({
    name: 'pgdeck',
    auth,
    basePath,
    webRoot,
    cookieName: SESSION_COOKIE,
    csrf: { header: CSRF_HEADER, exempt: (c) => isExport(c.req.method, c.req.path) },
    api: apiRoutes(manager),
    mapError,
  });
}
