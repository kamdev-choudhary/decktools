import { Hono, type Context, type ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AuthConfig } from '@deck/config';
import { createLogger } from '@deck/logger';
import { createAuth } from './auth.js';
import { requireCsrfHeader } from './csrf.js';
import { loadAssets, serveAssets } from './static.js';

export interface DeckAppOptions {
  /** Tool name, used in log prefixes and messages. */
  name: string;
  /** Credentials, or null for --no-auth. */
  auth: AuthConfig | null;
  /** Prefix such as "/db" when a proxy forwards the path without stripping it ("" for none). */
  basePath: string;
  /** Directory holding the built web UI. */
  webRoot: string;
  /** Session cookie name. Keep it stable across releases. */
  cookieName: string;
  /** CSRF header the UI sends on API calls, and requests exempt from it. */
  csrf: { header: string; exempt?: (c: Context) => boolean };
  /** The tool's API, mounted at /api behind the session check. */
  api: Hono<any, any, any>;
  /**
   * Turn a tool-specific error into a response. Return undefined to fall
   * back to a logged 500. HTTPExceptions are handled before this is called.
   */
  mapError?: (err: Error, c: Context) => Response | Promise<Response> | undefined;
  /** Content-Security-Policy for the UI page (default: contentSecurityPolicy()). */
  csp?: string;
}

// Internal paths the prefix-aware router maps requests to.
const ADD_SLASH = '/__deck_add_slash';
const OUTSIDE_BASE = '/__deck_outside_base';

/**
 * The HTTP app every deck shares:
 *
 *   /healthz        liveness probe
 *   /api/auth/*     login, logout, session (CSRF-checked, public)
 *   /api/*          the tool's API (CSRF-checked, needs a session)
 *   everything else the built UI
 *
 * all of it optionally under a base path.
 */
export function createDeckApp({ name, auth, basePath, webRoot, cookieName, csrf, api, mapError, csp }: DeckAppOptions) {
  const log = createLogger(name);
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

  const onError: ErrorHandler = async (err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    const mapped = await mapError?.(err, c);
    if (mapped) return mapped;
    log.error(err);
    return c.json({ error: err.message || 'Internal error' }, 500);
  };
  app.onError(onError);

  app.get(ADD_SLASH, (c) => c.redirect(`${basePath}/${new URL(c.req.url).search}`, 301));
  app.all(OUTSIDE_BASE, (c) => c.json({ error: 'Not found' }, 404));
  app.get('/healthz', (c) => c.json({ ok: true }));

  const { routes: authRoutes, requireSession, authorizeCookieHeader } = createAuth({ auth, cookieName });

  // The UI itself is public (it's just the login screen until signed in);
  // everything under /api except the auth endpoints needs a session.
  app.use('/api/*', requireCsrfHeader(csrf));
  app.route('/api/auth', authRoutes);
  app.use('/api/*', requireSession);
  app.route('/api', api);
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  app.get('*', serveAssets(loadAssets(webRoot), { name, csp }));

  return { app, authorizeCookieHeader };
}
