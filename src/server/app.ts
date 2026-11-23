import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import type { Database } from '../db/index.js';
import { requireCsrfHeader } from './middleware/csrf.js';
import { handleError } from './middleware/errors.js';
import { apiRoutes } from './routes/api.js';
import { loadAssets, serveAssets } from './static.js';

export interface AuthConfig {
  username: string;
  password: string;
}

export interface AppOptions {
  db: Database;
  auth: AuthConfig | null;
  /** Prefix such as "/db" when a proxy forwards the path without stripping it. */
  basePath: string;
  /** Directory holding the built web UI. */
  webRoot: string;
}

// Internal paths the prefix-aware router maps requests to.
const ADD_SLASH = '/__pgdeck_add_slash';
const OUTSIDE_BASE = '/__pgdeck_outside_base';

export function createApp({ db, auth, basePath, webRoot }: AppOptions) {
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

  if (auth) {
    app.use('*', basicAuth({ username: auth.username, password: auth.password, realm: 'pgdeck' }));
  }

  app.use('/api/*', requireCsrfHeader);
  app.route('/api', apiRoutes(db));
  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.text('Not found', 404)));

  app.get('*', serveAssets(loadAssets(webRoot)));

  return app;
}

export type ApiApp = ReturnType<typeof apiRoutes>;
