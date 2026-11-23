import { Hono } from 'hono';
import type { Database, DatabaseManager } from '../../db/index.js';
import { UserError } from '../../db/errors.js';
import { deleteBody, insertBody, metaQuery, parse, queryBody, rowsBody, updateBody } from '../schemas.js';

async function jsonBody(req: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new UserError('Request body must be JSON');
  }
}

type DbEnv = { Variables: { db: Database } };

/** Routes that operate on one database, mounted at /api/db/:database. */
function databaseRoutes() {
  return new Hono<DbEnv>()
    .get('/info', async (c) => c.json(await c.var.db.info()))
    .get('/tables', async (c) => c.json(await c.var.db.tables()))
    .get('/stats', async (c) => c.json(await c.var.db.stats()))
    .get('/meta', async (c) => {
      const { schema, table } = parse(metaQuery, c.req.query());
      return c.json(await c.var.db.meta(schema, table));
    })
    .post('/rows', async (c) => {
      const body = parse(rowsBody, await jsonBody(c.req));
      return c.json(await c.var.db.rows(body));
    })
    .post('/insert', async (c) => {
      const { schema, table, values } = parse(insertBody, await jsonBody(c.req));
      return c.json(await c.var.db.insert(schema, table, values));
    })
    .post('/update', async (c) => {
      const { schema, table, key, values } = parse(updateBody, await jsonBody(c.req));
      return c.json(await c.var.db.update(schema, table, key, values));
    })
    .post('/delete', async (c) => {
      const { schema, table, keys } = parse(deleteBody, await jsonBody(c.req));
      return c.json(await c.var.db.remove(schema, table, keys));
    })
    .post('/query', async (c) => {
      const { sql } = parse(queryBody, await jsonBody(c.req));
      return c.json(await c.var.db.query(sql));
    });
}

export function apiRoutes(manager: DatabaseManager) {
  const perDb = new Hono<DbEnv>()
    .use('*', async (c, next) => {
      c.set('db', await manager.get(c.req.param('database') ?? ''));
      await next();
    })
    .route('/', databaseRoutes());

  return new Hono()
    .get('/databases', async (c) => c.json(await manager.list()))
    .route('/db/:database', perDb);
}
