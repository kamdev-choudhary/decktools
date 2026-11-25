import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { createDeckApp, type DeckAppOptions } from '../src/index.js';

const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-ui-'));
fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>ui</title>');
fs.mkdirSync(path.join(webRoot, 'assets'));
fs.writeFileSync(path.join(webRoot, 'assets', 'app-abc123.js'), 'console.log(1)');

class TeapotError extends Error {}

function make(overrides: Partial<DeckAppOptions> = {}) {
  const api = new Hono()
    .get('/ping', (c) => c.json({ pong: true }))
    .get('/download', (c) => c.text('file'))
    .get('/teapot', () => {
      throw new TeapotError('short and stout');
    })
    .get('/crash', () => {
      throw new Error('kaboom');
    });
  return createDeckApp({
    name: 'testdeck',
    auth: { username: 'admin', password: 'pw' },
    basePath: '',
    webRoot,
    cookieName: 'testdeck_session',
    csrf: { header: 'x-testdeck', exempt: (c) => c.req.path === '/api/download' },
    api,
    mapError: (err, c) => (err instanceof TeapotError ? c.json({ error: err.message }, 418) : undefined),
    ...overrides,
  }).app;
}

const H = { 'x-testdeck': '1' };
const login = (app: ReturnType<typeof make>, password = 'pw') =>
  app.request('/api/auth/login', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password }) });

describe('createDeckApp', () => {
  it('serves health and the UI publicly, with security headers', async () => {
    const app = make();
    assert.deepEqual(await (await app.request('/healthz')).json(), { ok: true });
    const page = await app.request('/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    const asset = await app.request('/assets/app-abc123.js');
    assert.match(asset.headers.get('cache-control') ?? '', /immutable/);
    assert.equal((await app.request('/missing.js')).status, 404);
  });

  it('requires the CSRF header on the API, except exempt routes', async () => {
    const app = make({ auth: null });
    const res = await app.request('/api/ping');
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'Missing x-testdeck header' });
    assert.equal((await app.request('/api/download')).status, 200);
  });

  it('gates the API behind a login session', async () => {
    const app = make();
    assert.equal((await app.request('/api/ping', { headers: H })).status, 401);
    assert.deepEqual(await (await app.request('/api/auth/session', { headers: H })).json(), { authRequired: true, authenticated: false, username: null });

    assert.equal((await login(app, 'wrong')).status, 401);
    const bad = await app.request('/api/auth/login', { method: 'POST', headers: H, body: '{}' });
    assert.equal(bad.status, 400);
    assert.match(((await bad.json()) as { error: string }).error, /^Invalid request:/);

    const ok = await login(app);
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie') ?? '';
    assert.match(cookie, /^testdeck_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);

    const sessionCookie = cookie.split(';')[0]!;
    const authed = await app.request('/api/ping', { headers: { ...H, cookie: sessionCookie } });
    assert.deepEqual(await authed.json(), { pong: true });

    await app.request('/api/auth/logout', { method: 'POST', headers: { ...H, cookie: sessionCookie } });
    assert.equal((await app.request('/api/ping', { headers: { ...H, cookie: sessionCookie } })).status, 401);
  });

  it('lets everything through with --no-auth', async () => {
    const app = make({ auth: null });
    assert.equal((await app.request('/api/ping', { headers: H })).status, 200);
  });

  it('serves under a base path', async () => {
    const app = make({ auth: null, basePath: '/db' });
    const redirect = await app.request('/db?x=1');
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), '/db/?x=1');
    assert.equal((await app.request('/healthz')).status, 404);
    assert.equal((await app.request('/db/healthz')).status, 200);
    assert.equal((await app.request('/db/api/ping', { headers: H })).status, 200);
    assert.equal((await app.request('/db/')).status, 200);
  });

  it('maps tool errors, and turns the rest into 500s', async () => {
    const app = make({ auth: null });
    const teapot = await app.request('/api/teapot', { headers: H });
    assert.equal(teapot.status, 418);
    const error = console.error;
    console.error = () => {};
    try {
      const crash = await app.request('/api/crash', { headers: H });
      assert.equal(crash.status, 500);
      assert.deepEqual(await crash.json(), { error: 'kaboom' });
    } finally {
      console.error = error;
    }
    assert.equal((await app.request('/api/nope', { headers: H })).status, 404);
  });

  it('explains when the UI is not built', async () => {
    const app = make({ webRoot: path.join(webRoot, 'nope') });
    const res = await app.request('/');
    assert.equal(res.status, 503);
    assert.match(await res.text(), /testdeck UI is not built/);
  });
});
