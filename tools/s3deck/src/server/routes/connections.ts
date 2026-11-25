import { Hono } from 'hono';
import { DEFAULT_REGION } from '../../shared/constants';
import { connectionInputSchema } from '../../shared/schemas';
import type { ConnectionsResponse } from '../../shared/types';
import { detectProvider } from '../../s3/provider';
import { connectionInfo, openConnection } from '../connections';
import type { AuthedEnv, ServerContext } from '../context';
import { HttpError, toErrorResponse } from '../errors';
import { logActivity } from '../middleware';
import type { Session } from '../sessions';
import { validate } from '../validate';

export function connectionRoutes(ctx: ServerContext) {
  const list = (session: Session): ConnectionsResponse => {
    const conns = ctx.connections.listForSession(session);
    const active =
      conns.find((c) => c.id === session.activeConnectionId) ??
      conns.find((c) => c.id === ctx.connections.defaultId) ??
      conns[0] ??
      null;
    if (active) session.activeConnectionId = active.id;
    return { activeId: active?.id ?? null, connections: conns.map(connectionInfo) };
  };

  return (
    new Hono<AuthedEnv>()
      .get('/', (c) => c.json(list(c.get('session'))))

      /** Credentials entered in the browser. Used server-side only and never returned. */
      .post('/', validate('json', connectionInputSchema), async (c) => {
        if (!ctx.config.allowBrowserConnections) {
          throw new HttpError(403, 'DISABLED', 'Adding connections from the browser is disabled on this server');
        }
        const session = c.get('session');
        const input = c.req.valid('json');
        if (input.remember && !ctx.saved) {
          throw new HttpError(
            400,
            'NO_PERSISTENCE',
            'This server has no data directory, so connections can’t be remembered',
          );
        }
        const endpoint = input.endpoint || null;
        const provider = detectProvider(endpoint);
        const region = input.region || provider.defaultRegion || DEFAULT_REGION;
        const pathStyle = input.pathStyle ?? 'auto';
        const credentials = {
          accessKeyId: input.accessKeyId,
          secretAccessKey: input.secretAccessKey,
          sessionToken: input.sessionToken || undefined,
        };

        let result;
        try {
          result = await openConnection({
            source: input.remember ? 'saved' : 'browser',
            ownerSessionId: input.remember ? undefined : session.id,
            ownerUser: input.remember ? session.user : undefined,
            label: input.label,
            endpoint,
            region,
            pathStyle,
            accessKeyId: input.accessKeyId,
            credentials,
            pinnedBuckets: input.buckets ?? [],
            publicUrlBase: input.publicUrlBase || null,
          });
        } catch (err) {
          const { body } = toErrorResponse(err);
          const hint =
            body.error.code === 'AccessDenied'
              ? ' The key works but cannot list buckets; add the bucket names you want to open.'
              : '';
          throw new HttpError(
            400,
            'CONNECT_FAILED',
            `Could not connect: ${body.error.message.replace(/\.+$/, '')}.${hint}`,
          );
        }

        const conn = result.connection;
        ctx.connections.addForSession(conn);
        if (input.remember && ctx.saved) {
          try {
            await ctx.saved.add({
              id: conn.id,
              owner: session.user,
              label: input.label,
              endpoint,
              region,
              pathStyle,
              ...credentials,
              buckets: input.buckets ?? [],
              publicUrlBase: input.publicUrlBase || null,
              savedAt: new Date().toISOString(),
            });
          } catch (err) {
            ctx.connections.remove(conn.id);
            throw err;
          }
        }
        session.activeConnectionId = conn.id;
        logActivity(ctx, c, input.remember ? 'connection.remember' : 'connection.add', { detail: conn.label });
        return c.json({ ...list(session), bucketCount: result.bucketCount }, 201);
      })

      .post('/:id/activate', (c) => {
        const session = c.get('session');
        const conn = ctx.connections.getForSession(c.req.param('id'), session);
        if (!conn) throw new HttpError(404, 'NOT_FOUND', 'Connection not found');
        session.activeConnectionId = conn.id;
        return c.json(list(session));
      })

      .delete('/:id', async (c) => {
        const session = c.get('session');
        const conn = ctx.connections.getForSession(c.req.param('id'), session);
        if (!conn) throw new HttpError(404, 'NOT_FOUND', 'Connection not found');
        if (conn.source === 'cli') throw new HttpError(400, 'NOT_ALLOWED', 'The startup connection cannot be removed');
        if (conn.source === 'saved') await ctx.saved?.remove(conn.id);
        ctx.connections.remove(conn.id);
        ctx.sessions.reassign(conn.id, ctx.connections.defaultId);
        logActivity(ctx, c, conn.source === 'saved' ? 'connection.forget' : 'connection.remove', {
          detail: conn.label,
        });
        return c.json(list(session));
      })
  );
}
