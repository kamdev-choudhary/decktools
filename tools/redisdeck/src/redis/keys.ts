import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { KeyAction, KeyDetail, KeyPage, KeySummary, KeyValue, NewKey } from '../shared/types.js';
import { READONLY_ERROR, UserError } from './errors.js';
import { keyFromId, keyId, toRText } from './text.js';

/** Strings larger than this are shown truncated (and can't be edited in place). */
export const STRING_PREVIEW_BYTES = 256 * 1024;
/** Elements per page of a collection. */
export const PAGE = 200;

export interface ScanOptions {
  cursor: string;
  match: string;
  type?: string;
  /** Stop once this many keys were found (SCAN may return fewer or more per call). */
  limit: number;
}

/**
 * One page of keys. SCAN with a MATCH can return few keys per call on a big
 * keyspace, so keep scanning until there are enough or ~300 ms have passed.
 */
export async function scanKeys(client: Redis, { cursor, match, type, limit }: ScanOptions): Promise<KeyPage> {
  const found = new Map<string, Buffer>();
  const started = Date.now();
  let cur = cursor;
  do {
    const args: (string | number)[] = [cur, 'MATCH', match || '*', 'COUNT', 1000];
    if (type) args.push('TYPE', type);
    const [next, keys] = (await client.callBuffer('SCAN', args)) as [Buffer, Buffer[]];
    cur = next.toString();
    for (const k of keys) found.set(keyId(k), k);
  } while (cur !== '0' && found.size < limit && Date.now() - started < 300);

  const raw = [...found.values()];
  const pipe = client.pipeline();
  for (const k of raw) pipe.type(k).pttl(k);
  const res = raw.length ? ((await pipe.exec()) ?? []) : [];
  const keys: KeySummary[] = raw.map((k, i) => ({
    id: keyId(k),
    name: toRText(k),
    type: String(res[i * 2]?.[1] ?? 'none'),
    ttl: Number(res[i * 2 + 1]?.[1] ?? -2),
  }));
  return { keys: keys.filter((k) => k.type !== 'none'), cursor: cur };
}

export interface DetailOptions {
  /** HSCAN/SSCAN cursor, or the stream id to continue after. */
  cursor?: string;
  /** LRANGE/ZRANGE offset. */
  offset?: number;
}

const pairs = (flat: Buffer[]) => {
  const out: [Buffer, Buffer][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  return out;
};

async function readValue(client: Redis, key: Buffer, type: string, { cursor = '0', offset = 0 }: DetailOptions): Promise<{ value: KeyValue; length: number }> {
  switch (type) {
    case 'string': {
      const length = await client.strlen(key);
      const buf = await client.getrangeBuffer(key, 0, STRING_PREVIEW_BYTES - 1);
      return { value: { type, value: toRText(buf), truncated: length > STRING_PREVIEW_BYTES }, length };
    }
    case 'hash': {
      const [next, flat] = (await client.callBuffer('HSCAN', [key, cursor, 'COUNT', PAGE])) as [Buffer, Buffer[]];
      return {
        value: { type, entries: pairs(flat).map(([f, v]) => ({ field: toRText(f), value: toRText(v) })), cursor: next.toString() },
        length: await client.hlen(key),
      };
    }
    case 'list': {
      const items = await client.lrangeBuffer(key, offset, offset + PAGE - 1);
      return { value: { type, items: items.map((v, i) => ({ index: offset + i, value: toRText(v) })), offset }, length: await client.llen(key) };
    }
    case 'set': {
      const [next, members] = (await client.callBuffer('SSCAN', [key, cursor, 'COUNT', PAGE])) as [Buffer, Buffer[]];
      return { value: { type, members: members.map(toRText), cursor: next.toString() }, length: await client.scard(key) };
    }
    case 'zset': {
      const flat = (await client.callBuffer('ZRANGE', [key, offset, offset + PAGE - 1, 'WITHSCORES'])) as Buffer[];
      return {
        value: { type, members: pairs(flat).map(([m, s]) => ({ member: toRText(m), score: s.toString() })), offset },
        length: await client.zcard(key),
      };
    }
    case 'stream': {
      // Newest first; continue strictly after the last id shown.
      const start = cursor && cursor !== '0' ? `(${cursor}` : '+';
      const raw = (await client.callBuffer('XREVRANGE', [key, start, '-', 'COUNT', PAGE])) as [Buffer, Buffer[]][];
      const entries = raw.map(([id, flat]) => ({ id: id.toString(), fields: pairs(flat).map(([f, v]) => ({ field: toRText(f), value: toRText(v) })) }));
      return { value: { type, entries, next: entries.length === PAGE ? entries.at(-1)!.id : null }, length: await client.xlen(key) };
    }
    case 'ReJSON-RL': {
      const json = String(await client.call('JSON.GET', [key]));
      return { value: { type, json }, length: Buffer.byteLength(json) };
    }
    default:
      return { value: { type: 'unsupported', message: `redisdeck can't display "${type}" keys yet. Use the console to work with them.` }, length: 0 };
  }
}

export async function keyDetail(client: Redis, id: string, opts: DetailOptions = {}): Promise<KeyDetail> {
  const key = keyFromId(id);
  const type = await client.type(key);
  if (type === 'none') throw new UserError('This key no longer exists. It may have expired or been deleted.', 404);
  const [ttl, encoding, memory, read] = await Promise.all([
    client.pttl(key),
    client.call('OBJECT', ['ENCODING', key]).then(String, () => null),
    client.call('MEMORY', ['USAGE', key]).then((v) => (v === null ? null : Number(v)), () => null),
    readValue(client, key, type, opts),
  ]);
  return { id, name: toRText(key), type, ttl, encoding, memory, length: read.length, value: read.value };
}

function writable(readonly: boolean) {
  if (readonly) throw new UserError(READONLY_ERROR, 403);
}

/** Run a MULTI and surface the first error inside it. */
async function exec(multi: ReturnType<Redis['multi']>): Promise<unknown[]> {
  const res = (await multi.exec()) ?? [];
  const failed = res.find(([err]) => err);
  if (failed) throw failed[0];
  return res.map(([, v]) => v);
}

export async function applyAction(client: Redis, action: KeyAction, readonly: boolean): Promise<string> {
  writable(readonly);
  if (action.op === 'delete') {
    const n = await client.unlink(...action.ids.map(keyFromId));
    return `Deleted ${n} key${n === 1 ? '' : 's'}`;
  }

  const key = keyFromId(action.id);
  switch (action.op) {
    case 'rename': {
      if (!action.newName) throw new UserError('The new name can\'t be empty');
      const ok = await client.renamenx(key, action.newName);
      if (!ok) throw new UserError(`A key named "${action.newName}" already exists`, 409);
      return `Renamed to ${action.newName}`;
    }
    case 'expire': {
      if (action.seconds === null) {
        await client.persist(key);
        return 'Expiry removed';
      }
      if (!Number.isInteger(action.seconds) || action.seconds <= 0) throw new UserError('TTL must be a whole number of seconds, above 0');
      await client.expire(key, action.seconds);
      return `Expires in ${action.seconds} s`;
    }
    case 'string.set':
      await client.set(key, action.value, 'KEEPTTL');
      return 'Value saved';
    case 'hash.set': {
      const renaming = action.previousField !== undefined && action.previousField !== action.field;
      if (renaming && (await client.hexists(key, action.field))) throw new UserError(`Field "${action.field}" already exists`, 409);
      const m = client.multi();
      if (renaming) m.hdel(key, action.previousField!);
      m.hset(key, action.field, action.value);
      await exec(m);
      return 'Field saved';
    }
    case 'hash.delete':
      await client.hdel(key, ...action.fields);
      return `Deleted ${action.fields.length} field${action.fields.length === 1 ? '' : 's'}`;
    case 'list.set':
      await client.lset(key, action.index, action.value);
      return 'Element saved';
    case 'list.push':
      if (action.end === 'head') await client.lpushx(key, action.value);
      else await client.rpushx(key, action.value);
      return `Added to the ${action.end}`;
    case 'list.delete': {
      // Lists can't delete by index: mark the slot with a unique value, then remove that value.
      const marker = `__redisdeck_deleted_${randomUUID()}`;
      await exec(client.multi().lset(key, action.index, marker).lrem(key, 1, marker));
      return 'Element deleted';
    }
    case 'set.add': {
      const m = client.multi();
      if (action.previous !== undefined && action.previous !== action.member) m.srem(key, action.previous);
      m.sadd(key, action.member);
      await exec(m);
      return 'Member saved';
    }
    case 'set.delete':
      await client.srem(key, ...action.members);
      return `Removed ${action.members.length} member${action.members.length === 1 ? '' : 's'}`;
    case 'zset.add': {
      if (!Number.isFinite(action.score)) throw new UserError('Score must be a number');
      const m = client.multi();
      if (action.previous !== undefined && action.previous !== action.member) m.zrem(key, action.previous);
      m.zadd(key, action.score, action.member);
      await exec(m);
      return 'Member saved';
    }
    case 'zset.delete':
      await client.zrem(key, ...action.members);
      return `Removed ${action.members.length} member${action.members.length === 1 ? '' : 's'}`;
    case 'stream.add': {
      const flat = Object.entries(action.fields).flat();
      if (!flat.length) throw new UserError('An entry needs at least one field');
      const id = await client.xadd(key, '*', ...flat);
      return `Added entry ${id}`;
    }
    case 'stream.delete':
      await client.xdel(key, ...action.entryIds);
      return `Deleted ${action.entryIds.length} entr${action.entryIds.length === 1 ? 'y' : 'ies'}`;
    case 'json.set':
      parseJson(action.json);
      await client.call('JSON.SET', [key, '$', action.json]);
      return 'JSON saved';
  }
}

function parseJson(text: string) {
  try {
    JSON.parse(text);
  } catch (err) {
    throw new UserError(`Not valid JSON: ${(err as Error).message}`);
  }
}

export async function createKey(client: Redis, spec: NewKey, readonly: boolean): Promise<KeySummary> {
  writable(readonly);
  if (!spec.name) throw new UserError('The key needs a name');
  if (await client.exists(spec.name)) throw new UserError(`A key named "${spec.name}" already exists`, 409);
  if (spec.ttl !== undefined && (!Number.isInteger(spec.ttl) || spec.ttl <= 0)) throw new UserError('TTL must be a whole number of seconds, above 0');

  const m = client.multi();
  switch (spec.type) {
    case 'string':
      m.set(spec.name, spec.value);
      break;
    case 'hash':
      m.hset(spec.name, spec.field, spec.value);
      break;
    case 'list':
      m.rpush(spec.name, spec.value);
      break;
    case 'set':
      m.sadd(spec.name, spec.member);
      break;
    case 'zset':
      if (!Number.isFinite(spec.score)) throw new UserError('Score must be a number');
      m.zadd(spec.name, spec.score, spec.member);
      break;
    case 'stream':
      m.xadd(spec.name, '*', spec.field, spec.value);
      break;
    case 'ReJSON-RL':
      parseJson(spec.json);
      m.call('JSON.SET', spec.name, '$', spec.json);
      break;
  }
  if (spec.ttl !== undefined) m.expire(spec.name, spec.ttl);
  await exec(m);
  const raw = Buffer.from(spec.name, 'utf8');
  return { id: keyId(raw), name: toRText(raw), type: spec.type, ttl: spec.ttl ? spec.ttl * 1000 : -1 };
}
