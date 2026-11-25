import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import { applyAction, createKey, keyDetail, runCommand, scanKeys, serverInfo, slowlog, statsSample, UserError, type RedisManager } from '../redis/index.js';
import { actionBody, commandBody, createBody, keyQuery, keysQuery, parse } from './schemas.js';

async function jsonBody(req: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new UserError('Request body must be JSON');
  }
}

type DbEnv = { Variables: { client: Redis; console: () => Promise<Redis> } };

export function apiRoutes(manager: RedisManager) {
  const db = new Hono<DbEnv>()
    .use(async (c, next) => {
      const index = Number(c.req.param('db' as never));
      c.set('client', await manager.get(index));
      c.set('console', () => manager.get(index, 'console'));
      await next();
    })
    .get('/keys', async (c) => {
      const q = parse(keysQuery, c.req.query());
      return c.json(await scanKeys(c.var.client, { cursor: q.cursor, match: q.match, type: q.type || undefined, limit: q.limit }));
    })
    .get('/size', async (c) => c.json({ keys: await c.var.client.dbsize() }))
    .get('/key', async (c) => {
      const q = parse(keyQuery, c.req.query());
      return c.json(await keyDetail(c.var.client, q.id, { cursor: q.cursor, offset: q.offset }));
    })
    .post('/key/action', async (c) => {
      const action = parse(actionBody, await jsonBody(c.req));
      return c.json({ ok: true, message: await applyAction(c.var.client, action, manager.readonly) });
    })
    .post('/key/create', async (c) => {
      const spec = parse(createBody, await jsonBody(c.req));
      return c.json(await createKey(c.var.client, spec, manager.readonly));
    })
    .post('/command', async (c) => {
      const { command } = parse(commandBody, await jsonBody(c.req));
      return c.json(await runCommand(await c.var.console(), command, manager.readonly));
    });

  return new Hono()
    .get('/server', async (c) => c.json(await serverInfo(manager, await manager.get(manager.defaultDb))))
    .get('/stats', async (c) => c.json(await statsSample(await manager.get(manager.defaultDb))))
    .get('/slowlog', async (c) => c.json(await slowlog(await manager.get(manager.defaultDb))))
    .route('/db/:db{[0-9]+}', db);
}
