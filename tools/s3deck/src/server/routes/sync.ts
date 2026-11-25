import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { compareLocations, runSync, type Location } from '../../s3/sync';
import { compareSchema, syncSchema } from '../../shared/schemas';
import type { AuthedEnv, ServerContext } from '../context';
import { HttpError } from '../errors';
import { hasRole, logActivity, writable } from '../middleware';
import { validate } from '../validate';

type LocationInput = z.infer<typeof compareSchema>['source'];

/** Compare two folders (on any connections) and copy or mirror one onto the other in the background. */
export function syncRoutes(ctx: ServerContext) {
  const resolve = (c: Context<AuthedEnv>, loc: LocationInput): Location & { connectionId: string; label: string } => {
    const conn = ctx.connections.getForSession(loc.connectionId, c.get('session'));
    if (!conn) throw new HttpError(404, 'NOT_FOUND', 'Connection not found');
    const prefix = loc.prefix && !loc.prefix.endsWith('/') ? `${loc.prefix}/` : loc.prefix;
    return { client: conn.handle.client, bucket: loc.bucket, prefix, connectionId: conn.id, label: conn.label };
  };
  const describe = (l: { bucket: string; prefix: string }) => `${l.bucket}/${l.prefix}`;
  const owner = (c: Context<AuthedEnv>) => (hasRole(c.get('session').role, 'admin') ? null : c.get('session').user);

  return new Hono<AuthedEnv>()
    .post('/sync/compare', validate('json', compareSchema), async (c) => {
      const { source, target } = c.req.valid('json');
      return c.json(await compareLocations(resolve(c, source), resolve(c, target), c.req.raw.signal));
    })

    .post('/sync', writable(ctx) as never, validate('json', syncSchema), (c) => {
      const input = c.req.valid('json');
      const source = resolve(c, input.source);
      const target = resolve(c, input.target);
      if (source.connectionId === target.connectionId && source.bucket === target.bucket) {
        if (target.prefix.startsWith(source.prefix) || source.prefix.startsWith(target.prefix)) {
          throw new HttpError(400, 'VALIDATION', 'Source and target folders overlap');
        }
      }
      const title = `${input.mode === 'mirror' ? 'Mirror' : 'Copy'} ${describe(source)} → ${describe(target)}`;
      const job = ctx.jobs.start(c.get('session').user, title, (signal, progress) =>
        runSync({
          source,
          target,
          sameConnection: source.connectionId === target.connectionId,
          mode: input.mode,
          signal,
          progress,
        }),
      );
      logActivity(ctx, c, `sync.${input.mode}`, {
        bucket: target.bucket,
        detail: `${source.label}:${describe(source)} → ${target.label}:${describe(target)}`,
      });
      return c.json(job, 201);
    })

    .get('/jobs', (c) => c.json({ jobs: ctx.jobs.list(owner(c)) }))

    .get('/jobs/:id', (c) => {
      const job = ctx.jobs.get(c.req.param('id'), owner(c));
      if (!job) throw new HttpError(404, 'NOT_FOUND', 'Job not found');
      return c.json(job);
    })

    .delete('/jobs/:id', (c) => {
      if (!ctx.jobs.cancel(c.req.param('id'), owner(c)))
        throw new HttpError(404, 'NOT_FOUND', 'No running job with that ID');
      return c.json({ ok: true });
    });
}
