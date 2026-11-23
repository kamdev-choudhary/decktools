import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { EXPORT_META } from '../../shared/export.js';
import type { Database, DatabaseManager } from '../../db/index.js';
import { UserError } from '../../db/errors.js';
import { deleteBody, exportQuery, importQuery, insertBody, metaQuery, parse, queryBody, rowsBody, updateBody } from '../schemas.js';

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
    .get('/export', async (c) => {
      const q = parse(exportQuery, c.req.query());
      const meta = EXPORT_META[q.format];
      const name = `${q.table}.${meta.ext}`;
      const ac = new AbortController();
      const chunks = c.var.db.exportRows(q, ac.signal);
      // Pull the first chunk before committing to a 200, so bad requests still get a JSON error.
      const first = await chunks.next();

      c.header('content-type', `${meta.mime}; charset=utf-8`);
      c.header('content-disposition', `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
      c.header('cache-control', 'no-store');
      c.header('x-content-type-options', 'nosniff');
      return stream(c, async (s) => {
        s.onAbort(() => ac.abort());
        if (!first.done && first.value) await s.write(first.value);
        for await (const chunk of chunks) if (chunk) await s.write(chunk);
      });
    })
    .post('/import', async (c) => {
      const q = parse(importQuery, c.req.query());
      const body = c.req.raw.body;
      if (!body) throw new UserError('The upload is empty');
      return c.json(await c.var.db.importRows(q, Readable.fromWeb(body as unknown as WebReadableStream<Uint8Array>)));
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
