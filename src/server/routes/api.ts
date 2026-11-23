import { Hono } from 'hono';
import type { Database } from '../../db/index.js';
import { UserError } from '../../db/errors.js';
import { deleteBody, insertBody, metaQuery, parse, queryBody, rowsBody, updateBody } from '../schemas.js';

async function jsonBody(req: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new UserError('Request body must be JSON');
  }
}

export function apiRoutes(db: Database) {
  return new Hono()
    .get('/info', async (c) => c.json(await db.info()))
    .get('/tables', async (c) => c.json(await db.tables()))
    .get('/meta', async (c) => {
      const { schema, table } = parse(metaQuery, c.req.query());
      return c.json(await db.meta(schema, table));
    })
    .post('/rows', async (c) => {
      const body = parse(rowsBody, await jsonBody(c.req));
      return c.json(await db.rows(body));
    })
    .post('/insert', async (c) => {
      const { schema, table, values } = parse(insertBody, await jsonBody(c.req));
      return c.json(await db.insert(schema, table, values));
    })
    .post('/update', async (c) => {
      const { schema, table, key, values } = parse(updateBody, await jsonBody(c.req));
      return c.json(await db.update(schema, table, key, values));
    })
    .post('/delete', async (c) => {
      const { schema, table, keys } = parse(deleteBody, await jsonBody(c.req));
      return c.json(await db.remove(schema, table, keys));
    })
    .post('/query', async (c) => {
      const { sql } = parse(queryBody, await jsonBody(c.req));
      return c.json(await db.query(sql));
    });
}
