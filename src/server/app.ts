import { Hono } from 'hono';
import type { DatabaseManager } from '../db/index.js';
import { createAuth, type AuthConfig } from './auth/routes.js';
import { requireCsrfHeader } from './middleware/csrf.js';
import { handleError } from './middleware/errors.js';
import { apiRoutes } from './routes/api.js';
import { loadAssets, serveAssets } from './static.js';

export type { AuthConfig } from './auth/routes.js';

export interface AppOptions {
  manager: DatabaseManager;
  auth: AuthConfig | null;
  /** Prefix such as "/db" when a proxy forwards the path without stripping it. */
  basePath: string;
  /** Directory holding the built web UI. */
  webRoot: string;
}

// Internal paths the prefix-aware router maps requests to.
const ADD_SLASH = '/__pgdeck_add_slash';
const OUTSIDE_BASE = '/__pgdeck_outside_base';

export function createApp({ manager, auth, basePath, webRoot }: AppOptions) {
  const app = new Hono({
    // Strip the base path ourselves so every route below is written as if
    // the app were mounted at "/". The UI uses relative URLs, so it works
    // under any prefix as long as the page URL ends with a slash.
    getPath: (req) => {
      const pathname = new URL(req.url).pathname;
      if (!basePath) return pathname;
      if (pathname === basePath) return ADD_SLASH;
      if (!pathname.startsWith(basePath + '/')) return OUTSIDE_BASE;
      return pathname.slice(basePath.length);
    },
  });

  app.onError(handleError);

  app.get(ADD_SLASH, (c) => c.redirect(`${basePath}/${new URL(c.req.url).search}`, 301));
  app.all(OUTSIDE_BASE, (c) => c.json({ error: 'Not found' }, 404));
  app.get('/healthz', (c) => c.json({ ok: true }));

  const { routes: authRoutes, requireSession } = createAuth(auth);

  // The UI itself is public (it's just the login screen until signed in);
  // everything under /api except the auth endpoints needs a session.
  app.use('/api/*', requireCsrfHeader);
  app.route('/api/auth', authRoutes);
  app.use('/api/*', requireSession);
  app.route('/api', apiRoutes(manager));
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  app.get('*', serveAssets(loadAssets(webRoot)));

  return app;
}
