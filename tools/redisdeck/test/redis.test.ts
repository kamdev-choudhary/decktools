import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Redis } from 'ioredis';
import { RedisManager } from '../src/redis/index.js';
import { createApp } from '../src/server/app.js';
import type { CommandResult, KeyDetail, KeyPage, ServerInfo } from '../src/shared/types.js';

// These tests start their own throwaway redis-server (no persistence, random
// port), so they never touch a real instance. Without redis-server they skip.
const hasRedis = spawnSync('redis-server', ['--version']).status === 0;

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

/** Resolve once something accepts TCP connections on the port (redis-server takes a moment to start). */
async function waitForPort(port: number, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = net.connect(port, '127.0.0.1', () => (sock.end(), resolve(true)));
      sock.on('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`redis-server did not start on port ${port}`);
}

let server: ChildProcess;
let port: number;
let raw: Redis;
const H = { 'x-redisdeck': '1', 'content-type': 'application/json' };
const id = (key: string | Buffer) => Buffer.from(key).toString('base64');

function appFor(readonly: boolean) {
  const manager = new RedisManager({ url: `redis://127.0.0.1:${port}`, readonly, tlsInsecure: false });
  const { app } = createApp({ manager, auth: null, basePath: '', webRoot: '/nonexistent' });
  const get = async <T>(p: string) => {
    const res = await app.request(`/api/${p}`, { headers: H });
    return { status: res.status, body: (await res.json()) as T };
  };
  const post = async <T>(p: string, body: unknown) => {
    const res = await app.request(`/api/${p}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as T };
  };
  return { manager, get, post };
}

describe('redisdeck against a real Redis', { skip: !hasRedis && 'redis-server not installed' }, () => {
  const rw = () => apps.rw;
  const apps = {} as { rw: ReturnType<typeof appFor>; ro: ReturnType<typeof appFor> };

  before(async () => {
    port = await freePort();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redisdeck-test-'));
    server = spawn('redis-server', ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--dir', dir], { stdio: 'ignore' });
    await waitForPort(port);
    raw = new Redis({ port, lazyConnect: true });
    await raw.connect();
    await raw.flushall();
    await raw.set('greeting', 'hello', 'EX', 3600);
    await raw.hset('user:1', 'name', 'Ada', 'email', 'ada@example.com');
    await raw.rpush('queue', 'a', 'b', 'c');
    await raw.sadd('tags', 'red', 'green');
    await raw.zadd('scores', 10, 'alice', 20, 'bob');
    await raw.xadd('events', '*', 'kind', 'signup');
    await raw.set(Buffer.from([0x62, 0x69, 0x6e, 0xff]), Buffer.from([0x00, 0xfe]));
    await raw.select(3);
    await raw.set('in-db-3', 'x');
    await raw.select(0);
    apps.rw = appFor(false);
    apps.ro = appFor(true);
  });

  after(async () => {
    await apps.rw?.manager.closeAll();
    await apps.ro?.manager.closeAll();
    raw?.disconnect();
    server?.kill();
  });

  it('reports server info and the keyspace', async () => {
    const { body } = await rw().get<ServerInfo>('server');
    assert.match(body.version, /^\d+\./);
    assert.equal(body.databases, 16);
    assert.deepEqual(body.keyspace.map((d) => d.index), [0, 3]);
  });

  it('scans keys with types and TTLs, per database and by pattern and type', async () => {
    const { body } = await rw().get<KeyPage>('db/0/keys');
    assert.equal(body.cursor, '0');
    const byName = Object.fromEntries(body.keys.map((k) => [k.name.text, k]));
    assert.equal(byName['user:1']?.type, 'hash');
    assert.ok(byName.greeting!.ttl > 0);
    assert.equal(byName.queue!.ttl, -1);

    assert.deepEqual((await rw().get<KeyPage>('db/0/keys?match=user:*')).body.keys.map((k) => k.name.text), ['user:1']);
    assert.deepEqual((await rw().get<KeyPage>('db/0/keys?type=zset')).body.keys.map((k) => k.name.text), ['scores']);
    assert.deepEqual((await rw().get<KeyPage>('db/3/keys')).body.keys.map((k) => k.name.text), ['in-db-3']);
    assert.equal((await rw().get('db/16/keys')).status, 404);
  });

  it('round-trips binary keys and shows binary values escaped', async () => {
    const { body } = await rw().get<KeyPage>('db/0/keys?match=bin*');
    const k = body.keys[0]!;
    assert.deepEqual(k.name, { text: 'bin\\xff', binary: true });
    const detail = (await rw().get<KeyDetail>(`db/0/key?id=${encodeURIComponent(k.id)}`)).body;
    assert.deepEqual(detail.value, { type: 'string', value: { text: '\\x00\\xfe', binary: true }, truncated: false });
  });

  it('reads each type', async () => {
    const d = async (name: string) => (await rw().get<KeyDetail>(`db/0/key?id=${encodeURIComponent(id(name))}`)).body;
    assert.deepEqual((await d('greeting')).value, { type: 'string', value: { text: 'hello' }, truncated: false });
    const hash = await d('user:1');
    assert.equal(hash.length, 2);
    assert.ok(hash.value.type === 'hash' && hash.value.entries.some((e) => e.field.text === 'email' && e.value.text === 'ada@example.com'));
    const list = await d('queue');
    assert.ok(list.value.type === 'list' && list.value.items.map((i) => i.value.text).join() === 'a,b,c');
    const zset = await d('scores');
    assert.ok(zset.value.type === 'zset' && zset.value.members[1]!.score === '20');
    const stream = await d('events');
    assert.ok(stream.value.type === 'stream' && stream.value.entries[0]!.fields[0]!.value.text === 'signup');
    assert.equal((await rw().get(`db/0/key?id=${id('missing')}`)).status, 404);
  });

  it('edits values', async () => {
    const act = (body: unknown) => rw().post<{ message: string }>('db/0/key/action', body);
    assert.equal((await act({ op: 'string.set', id: id('greeting'), value: 'hi' })).status, 200);
    assert.equal(await raw.get('greeting'), 'hi');
    assert.ok((await raw.ttl('greeting')) > 0, 'editing keeps the TTL');

    await act({ op: 'hash.set', id: id('user:1'), field: 'mail', value: 'ada@x.io', previousField: 'email' });
    assert.deepEqual(await raw.hgetall('user:1'), { name: 'Ada', mail: 'ada@x.io' });
    assert.equal((await act({ op: 'hash.set', id: id('user:1'), field: 'name', value: 'x', previousField: 'mail' })).status, 409);

    await act({ op: 'list.delete', id: id('queue'), index: 1 });
    assert.deepEqual(await raw.lrange('queue', 0, -1), ['a', 'c']);
    await act({ op: 'list.push', id: id('queue'), value: 'z', end: 'head' });
    assert.deepEqual(await raw.lrange('queue', 0, -1), ['z', 'a', 'c']);

    await act({ op: 'set.add', id: id('tags'), member: 'blue', previous: 'red' });
    assert.deepEqual((await raw.smembers('tags')).sort(), ['blue', 'green']);

    await act({ op: 'zset.add', id: id('scores'), member: 'alice', score: 99 });
    assert.equal(await raw.zscore('scores', 'alice'), '99');

    await act({ op: 'expire', id: id('tags'), seconds: 100 });
    assert.ok((await raw.ttl('tags')) > 0);
    await act({ op: 'expire', id: id('tags'), seconds: null });
    assert.equal(await raw.ttl('tags'), -1);

    assert.equal((await act({ op: 'rename', id: id('tags'), newName: 'queue' })).status, 409, 'never overwrites');
    await act({ op: 'rename', id: id('tags'), newName: 'labels' });
    assert.equal(await raw.exists('labels'), 1);
  });

  it('creates and deletes keys', async () => {
    const created = await rw().post<{ id: string }>('db/0/key/create', { type: 'hash', name: 'new:hash', field: 'f', value: 'v', ttl: 60 });
    assert.equal(created.status, 200);
    assert.ok((await raw.ttl('new:hash')) > 0);
    assert.equal((await rw().post('db/0/key/create', { type: 'string', name: 'new:hash', value: 'x' })).status, 409);
    await rw().post('db/0/key/action', { op: 'delete', ids: [created.body.id] });
    assert.equal(await raw.exists('new:hash'), 0);
  });

  it('runs console commands and keeps exact integers', async () => {
    const cmd = (command: string, app = rw()) => app.post<CommandResult>('db/0/command', { command });
    await raw.set('big', '9007199254740993');
    assert.deepEqual((await cmd('INCR big')).body.reply, { kind: 'integer', value: '9007199254740994' });
    assert.deepEqual((await cmd('GET "missing key"')).body.reply, { kind: 'nil' });
    assert.deepEqual((await cmd('LRANGE queue 0 -1')).body.reply.kind, 'array');
    // Scores are strings, as redis-cli shows them (RESP2), not integers.
    const z = (await cmd('ZRANGE scores 0 0 WITHSCORES')).body.reply;
    assert.ok(z.kind === 'array' && z.items[1]!.kind === 'string');
    assert.equal((await cmd('NOSUCHCOMMAND')).body.reply.kind, 'error');
    assert.equal((await cmd('SELECT 2')).status, 400);
    assert.equal((await cmd('BLPOP queue 0')).status, 400);
    assert.equal((await cmd('SUBSCRIBE news')).status, 400);
  });

  it('refuses every change in --readonly mode', async () => {
    const ro = apps.ro;
    assert.equal((await ro.post('db/0/key/action', { op: 'delete', ids: [id('queue')] })).status, 403);
    assert.equal((await ro.post('db/0/key/create', { type: 'string', name: 'x', value: 'y' })).status, 403);
    for (const c of ['SET a b', 'DEL queue', 'FLUSHALL', 'EVAL "return 1" 0', 'PUBLISH ch hi', 'CONFIG SET maxmemory 1']) {
      assert.equal((await ro.post('db/0/command', { command: c })).status, 403, c);
    }
    for (const c of ['GET greeting', 'CONFIG GET maxmemory', 'EVAL_RO "return 1" 0', 'INFO server', 'SLOWLOG GET 1']) {
      assert.equal((await ro.post('db/0/command', { command: c })).status, 200, c);
    }
    assert.equal(await raw.exists('queue'), 1);
  });
});
