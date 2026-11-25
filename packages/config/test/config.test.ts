import assert from 'node:assert/strict';
import os from 'node:os';
import { describe, it } from 'node:test';
import { firstExistingDir, isLoopback, normalizeBasePath, resolveAuth, serverUrl } from '../src/index.js';

describe('normalizeBasePath', () => {
  it('adds a leading slash and strips trailing ones', () => {
    assert.equal(normalizeBasePath(''), '');
    assert.equal(normalizeBasePath('/'), '');
    assert.equal(normalizeBasePath('db'), '/db');
    assert.equal(normalizeBasePath(' /db/// '), '/db');
    assert.equal(normalizeBasePath('/a/b/'), '/a/b');
  });
});

describe('hosts', () => {
  it('recognizes loopback interfaces', () => {
    for (const h of ['127.0.0.1', 'localhost', '::1']) assert.equal(isLoopback(h), true);
    for (const h of ['0.0.0.0', '::', '10.0.0.5']) assert.equal(isLoopback(h), false);
  });

  it('prints localhost for wildcard binds', () => {
    assert.equal(serverUrl('0.0.0.0', 8080, ''), 'http://localhost:8080/');
    assert.equal(serverUrl('127.0.0.1', 47615, '/db'), 'http://127.0.0.1:47615/db/');
  });
});

describe('resolveAuth', () => {
  const env = 'DECK_TEST_PASSWORD';

  it('returns null when auth is disabled', () => {
    assert.equal(resolveAuth({ enabled: false, username: 'admin', password: 'x' }), null);
  });

  it('prefers the flag, then the environment, then generates', () => {
    process.env[env] = 'from-env';
    try {
      assert.deepEqual(resolveAuth({ enabled: true, username: 'a', password: 'flag', passwordEnv: env }), { username: 'a', password: 'flag', generated: false });
      assert.deepEqual(resolveAuth({ enabled: true, username: 'a', passwordEnv: env }), { username: 'a', password: 'from-env', generated: false });
    } finally {
      delete process.env[env];
    }
    const generated = resolveAuth({ enabled: true, username: 'a', passwordEnv: env });
    assert.equal(generated?.generated, true);
    assert.equal(generated?.password.length, 12);
  });
});

describe('firstExistingDir', () => {
  it('picks the first existing candidate, else the first one', () => {
    assert.equal(firstExistingDir(['/definitely/not/here', os.tmpdir()]), os.tmpdir());
    assert.equal(firstExistingDir(['/nope/a', '/nope/b']), '/nope/a');
  });
});
