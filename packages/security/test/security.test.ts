import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { contentSecurityPolicy, generatePassword, LoginLimiter, redactCredentials, safeEqual, SessionStore } from '../src/index.js';

describe('SessionStore', () => {
  it('creates, touches and revokes sessions', () => {
    const store = new SessionStore();
    const token = store.create('admin');
    assert.equal(store.touch(token), 'admin');
    assert.equal(store.touch('nope'), null);
    assert.equal(store.touch(undefined), null);
    store.revoke(token);
    assert.equal(store.touch(token), null);
  });

  it('expires idle sessions after 12h', () => {
    mock.timers.enable({ apis: ['Date'], now: 0 });
    try {
      const store = new SessionStore();
      const token = store.create('admin');
      mock.timers.tick(11 * 3600_000);
      assert.equal(store.touch(token), 'admin', 'activity extends the idle window');
      mock.timers.tick(12 * 3600_000 + 1);
      assert.equal(store.touch(token), null);
    } finally {
      mock.timers.reset();
    }
  });
});

describe('LoginLimiter', () => {
  it('locks a client out after too many failures and resets on success', () => {
    const limiter = new LoginLimiter(3, 60_000);
    for (let i = 0; i < 3; i++) limiter.fail('a');
    assert.ok(limiter.retryAfter('a') > 0);
    assert.equal(limiter.retryAfter('b'), 0, 'other clients are unaffected');
    limiter.succeed('a');
    assert.equal(limiter.retryAfter('a'), 0);
  });
});

describe('secrets', () => {
  it('compares strings of any length', () => {
    assert.equal(safeEqual('hunter2', 'hunter2'), true);
    assert.equal(safeEqual('hunter2', 'hunter22'), false);
  });

  it('generates 12-character URL-safe passwords', () => {
    const p = generatePassword();
    assert.match(p, /^[A-Za-z0-9_-]{12}$/);
    assert.notEqual(p, generatePassword());
  });

  it('redacts passwords in URLs and keyword strings', () => {
    assert.equal(redactCredentials('postgres://me:secret@db:5432/app'), 'postgres://me:****@db:5432/app');
    assert.equal(redactCredentials('postgres://me@db/app'), 'postgres://me@db/app');
    assert.equal(redactCredentials('host=db password=secret user=me'), 'host=db password=**** user=me');
  });
});

describe('contentSecurityPolicy', () => {
  it('defaults to a same-origin policy', () => {
    assert.equal(
      contentSecurityPolicy(),
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'",
    );
  });

  it('lets a tool override one directive', () => {
    assert.match(contentSecurityPolicy({ 'img-src': "'self' data: blob:" }), /img-src 'self' data: blob:;/);
  });
});
