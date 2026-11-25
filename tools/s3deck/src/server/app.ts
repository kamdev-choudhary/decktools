import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { zipStream } from '../s3/transfers';
import type { AppEnv, AuthedEnv, ServerContext } from './context';
import { HttpError, onError } from './errors';
import { csrf, loadSession, requireAuth, withConnection } from './middleware';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { bucketRoutes } from './routes/buckets';
import { connectionRoutes } from './routes/connections';
import { contentDisposition, objectRoutes } from './routes/objects';
import { syncRoutes } from './routes/sync';
import { createStaticHandler } from './static';

export function createApp(ctx: ServerContext) {
  const { config } = ctx;

  // Browser-added connections end with the session that added them.
  ctx.sessions.onDestroy((s) => ctx.connections.removeOwnedBy(s.id));

  const api = new Hono<AppEnv>();
  api.use(csrf());
  api.use(loadSession(ctx));
  api.route('/auth', authRoutes(ctx));

  const authed = new Hono<AuthedEnv>();
  authed.use(requireAuth() as never);
  authed.route('/connections', connectionRoutes(ctx));
  authed.route('/admin', adminRoutes(ctx));
  authed.route('/', syncRoutes(ctx));

  const storage = new Hono<AuthedEnv>();
  storage.use(withConnection(ctx));
  storage.route('/buckets', bucketRoutes(ctx));
  storage.route('/buckets', objectRoutes(ctx));

  /** Step 2 of a ZIP download: a plain GET the browser can navigate to. */
  storage.get('/zip/:token', async (c) => {
    const session = c.get('session');
    const req = ctx.zipTokens.take(c.req.param('token'), session.id);
    if (!req) throw new HttpError(404, 'NOT_FOUND', 'This download link has expired');
    const conn = ctx.connections.getForSession(req.connectionId, session);
    if (!conn) throw new HttpError(409, 'NO_CONNECTION', 'Connection is gone');
    const archive = zipStream(conn.handle.client, req.bucket, req, c.req.raw.signal);
    return new Response(Readable.toWeb(archive) as ReadableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': contentDisposition('attachment', req.name),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  authed.route('/', storage);
  api.route('/', authed as never);
  api.all('*', () => {
    throw new HttpError(404, 'NOT_FOUND', 'No such API route');
  });

  const app = new Hono();
  app.onError(onError);
  app.use(
    secureHeaders({
      contentSecurityPolicy: undefined,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: 'same-origin',
      referrerPolicy: 'no-referrer',
      // PDF previews frame the download route, so same-origin framing must work.
      xFrameOptions: 'SAMEORIGIN',
    }),
  );

  const base = config.basePath; // "" or "/s3"
  if (base) app.get(base, (c) => c.redirect(`${base}/`, 301));

  app.get(`${base}/healthz`, (c) => c.json({ ok: true }));
  app.route(`${base}/api`, api);

  if (config.webRoot) {
    const serve = createStaticHandler(config.webRoot);
    app.get(`${base}/*`, (c) => {
      const rel = decodeURIComponent(c.req.path.slice(base.length + 1));
      return serve(c, rel);
    });
  }

  return app;
}
