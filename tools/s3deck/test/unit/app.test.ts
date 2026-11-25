import { describe, expect, it } from 'vitest';
import { ADMIN, client, testApp } from '../helpers';

describe('auth, CSRF and roles', () => {
  it('health check needs no login', async () => {
    const { app } = await testApp();
    const res = await app.request('http://localhost/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('requires the CSRF header on state-changing calls', async () => {
    const { app } = await testApp();
    const res = await app.request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ADMIN),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CSRF');
  });

  it('rejects anonymous API calls and wrong passwords', async () => {
    const { app } = await testApp();
    const c = client(app);
    expect((await c.get('/api/connections')).status).toBe(401);
    const bad = await c.login('admin', 'nope');
    expect(bad.status).toBe(401);
    expect(bad.json.error.code).toBe('BAD_CREDENTIALS');
  });

  it('validates request bodies with readable messages', async () => {
    const { app } = await testApp();
    const res = await client(app).post('/api/auth/login', { username: '' });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('VALIDATION');
    expect(res.json.error.message).toContain('username');
  });

  it('rate-limits repeated failed logins', async () => {
    const { app } = await testApp();
    const c = client(app);
    for (let i = 0; i < 5; i++) await c.login('admin', 'wrong');
    const res = await c.login(ADMIN.username, ADMIN.password);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
  });

  it('sets an HttpOnly, SameSite=Strict session cookie', async () => {
    const { app } = await testApp();
    const res = await app.request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-s3deck-csrf': '1' },
      body: JSON.stringify(ADMIN),
    });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('startup admin can manage users; roles are enforced', async () => {
    const { app } = await testApp();
    const admin = client(app);
    expect((await admin.login(ADMIN.username, ADMIN.password)).status).toBe(200);
    expect((await admin.get('/api/auth/me')).json).toMatchObject({ role: 'admin', can: { write: true, admin: true } });

    const created = await admin.post('/api/admin/users', {
      username: 'viv',
      password: 'viewer-pass-1',
      role: 'viewer',
    });
    expect(created.status).toBe(201);
    expect(created.json).not.toHaveProperty('passwordHash');

    const viewer = client(app);
    expect((await viewer.login('viv', 'viewer-pass-1')).status).toBe(200);
    expect((await viewer.get('/api/auth/me')).json).toMatchObject({
      role: 'viewer',
      can: { write: false, admin: false },
    });
    expect((await viewer.get('/api/admin/users')).status).toBe(403);
    // Changes need at least the editor role (checked before anything touches storage).
    expect((await viewer.post('/api/sync', {})).status).toBe(403);

    // Promote, then the next request sees the new role.
    await admin.patch('/api/admin/users/viv', { role: 'editor' });
    expect((await viewer.get('/api/auth/me')).json.role).toBe('editor');

    // Disabling ends the session.
    await admin.patch('/api/admin/users/viv', { disabled: true });
    expect((await viewer.get('/api/connections')).status).toBe(401);
    expect((await viewer.login('viv', 'viewer-pass-1')).status).toBe(401);
  });

  it('admins cannot lock themselves out', async () => {
    const { app } = await testApp();
    const admin = client(app);
    await admin.login(ADMIN.username, ADMIN.password);
    await admin.post('/api/admin/users', { username: 'boss', password: 'boss-password-1', role: 'admin' });
    const boss = client(app);
    await boss.login('boss', 'boss-password-1');
    expect((await boss.patch('/api/admin/users/boss', { role: 'viewer' })).status).toBe(400);
    expect((await boss.del('/api/admin/users/boss')).status).toBe(400);
  });

  it('read-only mode blocks writes even for admins', async () => {
    const { app } = await testApp({ readonly: true });
    const c = client(app);
    await c.login(ADMIN.username, ADMIN.password);
    expect((await c.get('/api/auth/me')).json.can.write).toBe(false);
  });

  it('storage routes explain when nothing is connected', async () => {
    const { app } = await testApp();
    const c = client(app);
    await c.login(ADMIN.username, ADMIN.password);
    const res = await c.get('/api/buckets');
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('NO_CONNECTION');
  });

  it('records changes in the activity log', async () => {
    const { app } = await testApp();
    const c = client(app);
    await c.login(ADMIN.username, ADMIN.password);
    await c.post('/api/admin/users', { username: 'ed', password: 'editor-pass-1', role: 'editor' });
    const log = await c.get('/api/admin/activity');
    const actions = log.json.entries.map((e: { action: string }) => e.action);
    expect(actions).toContain('user.create');
    expect(actions).toContain('login');
  });

  it('with --no-auth everyone is an anonymous admin', async () => {
    const { app } = await testApp({ auth: false });
    const me = await client(app).get('/api/auth/me');
    expect(me.json).toMatchObject({ authenticated: true, user: 'anonymous', role: 'admin' });
  });
});
