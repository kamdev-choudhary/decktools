import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redact, resolveConfig, type CliOptions } from '../src/cli/config.js';
import type { DatabaseManager } from '../src/db/index.js';
import { createApp, CSRF_HEADER, SESSION_COOKIE } from '../src/server/app.js';

// These names are a contract with browsers that already have pgdeck open and
// with the bundled UI; changing them logs people out or breaks every API call.
describe('pgdeck HTTP contract', () => {
  const manager = {} as DatabaseManager; // not reached by these requests
  const app = createApp({
    manager,
    auth: { username: 'admin', password: 'pw' },
    basePath: '',
    webRoot: '/nonexistent',
  }).app;

  it('keeps the pgdeck CSRF header and session cookie', async () => {
    assert.equal(CSRF_HEADER, 'x-pgdeck');
    assert.equal(SESSION_COOKIE, 'pgdeck_session');
    assert.equal((await app.request('/api/auth/session')).status, 403);
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'x-pgdeck': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'pw' }),
    });
    assert.match(res.headers.get('set-cookie') ?? '', /^pgdeck_session=/);
  });

  it('exempts only GET export/dump downloads from the CSRF header', async () => {
    // Past the CSRF check these fail the session check instead (401).
    assert.equal((await app.request('/api/db/app/export')).status, 401);
    assert.equal((await app.request('/api/db/app/dump')).status, 401);
    assert.equal((await app.request('/api/db/app/export', { method: 'POST' })).status, 403);
    assert.equal((await app.request('/api/db/app/tables')).status, 403);
  });
});

describe('pgdeck CLI config', () => {
  const opts: CliOptions = {
    port: 47615,
    host: '127.0.0.1',
    user: 'admin',
    auth: true,
    basePath: 'db/',
    open: false,
    readonly: false,
    ssl: false,
    maxRows: 2000,
  };

  it('reads PGDECK_PASSWORD and DATABASE_URL', () => {
    process.env.PGDECK_PASSWORD = 'env-pw';
    process.env.DATABASE_URL = 'postgres://localhost/app';
    try {
      const config = resolveConfig(undefined, opts);
      assert.equal(config.connectionString, 'postgres://localhost/app');
      assert.deepEqual(config.auth, { username: 'admin', password: 'env-pw', generated: false });
      assert.equal(config.basePath, '/db');
      assert.equal(resolveConfig('postgres://other/x', opts).connectionString, 'postgres://other/x');
    } finally {
      delete process.env.PGDECK_PASSWORD;
      delete process.env.DATABASE_URL;
    }
  });

  it('redacts connection strings for display', () => {
    assert.equal(redact(''), '(PG* environment defaults)');
    assert.equal(redact('postgres://me:secret@db/app'), 'postgres://me:****@db/app');
  });
});
