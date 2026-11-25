import assert from 'node:assert/strict';
import { stripVTControlCharacters as plain } from 'node:util';
import { describe, it } from 'node:test';
import { Command } from 'commander';
import { formatBanner, listenErrorMessage, parsePort, parsePositiveInt, serverOptions } from '../src/index.js';

describe('parsers', () => {
  it('accepts valid ports and rejects the rest', () => {
    assert.equal(parsePort('0'), 0);
    assert.equal(parsePort('65535'), 65535);
    for (const bad of ['-1', '65536', '1.5', 'abc']) assert.throws(() => parsePort(bad));
  });

  it('accepts positive integers only', () => {
    assert.equal(parsePositiveInt('2000'), 2000);
    for (const bad of ['0', '-3', '2.5']) assert.throws(() => parsePositiveInt(bad));
  });
});

describe('serverOptions', () => {
  const parse = (argv: string[]) => {
    const o = serverOptions({ defaultPort: 40000 });
    const cmd = new Command().exitOverride();
    for (const opt of Object.values(o)) cmd.addOption(opt);
    return cmd.parse(argv, { from: 'user' }).opts();
  };

  it('has safe defaults', () => {
    assert.deepEqual(parse([]), {
      port: Number(process.env.PORT) || 40000,
      host: '127.0.0.1',
      user: 'admin',
      auth: true,
      basePath: '',
      open: false,
    });
  });

  it('parses the standard flags', () => {
    const opts = parse([
      '-p',
      '8080',
      '-H',
      '0.0.0.0',
      '-u',
      'me',
      '-P',
      'pw',
      '--no-auth',
      '--base-path',
      '/x',
      '--open',
    ]);
    assert.deepEqual(opts, {
      port: 8080,
      host: '0.0.0.0',
      user: 'me',
      password: 'pw',
      auth: false,
      basePath: '/x',
      open: true,
    });
  });
});

describe('formatBanner', () => {
  const base = { name: 'demodeck', version: '1.2.3', url: 'http://127.0.0.1:1/', port: 1 };

  it('shows the login and keeps tool lines in place', () => {
    const out = plain(
      formatBanner({
        ...base,
        server: { host: '127.0.0.1', basePath: '/x', auth: { username: 'admin', password: 'pw', generated: true } },
        before: ['BEFORE'],
        after: ['AFTER'],
      }),
    );
    assert.match(out, /demodeck v1\.2\.3/);
    assert.match(out, /from this machine only/);
    assert.match(out, /Base path\s+\/x/);
    assert.match(out, /Login\s+admin \/ pw\s+\(generated/);
    assert.ok(out.indexOf('BEFORE') < out.indexOf('Web UI'));
    assert.ok(out.indexOf('Login') < out.indexOf('AFTER'));
    assert.doesNotMatch(out, /Auth is off/);
  });

  it('warns when auth is off on a network interface', () => {
    const out = plain(
      formatBanner({ ...base, server: { host: '0.0.0.0', basePath: '', auth: null }, resource: 'bucket' }),
    );
    assert.match(out, /from the network on all interfaces/);
    assert.match(out, /Auth is off and 0\.0\.0\.0 is reachable/);
    assert.match(out, /read and modify the bucket\./);
  });
});

describe('listenErrorMessage', () => {
  it('suggests the next port when the port is taken', () => {
    const err = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
    assert.equal(listenErrorMessage(err, 47615), 'Port 47615 is already in use. Try --port 47616');
    assert.equal(listenErrorMessage(new Error('boom'), 1), 'boom');
  });
});
