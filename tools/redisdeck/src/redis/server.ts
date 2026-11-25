import type { Redis } from 'ioredis';
import type { ServerInfo, SlowlogEntry, StatsSample } from '../shared/types.js';
import type { RedisManager } from './client.js';
import { flatInfo, num, parseInfo, parseKeyspace } from './info.js';

export async function serverInfo(manager: RedisManager, client: Redis): Promise<ServerInfo> {
  const sections = parseInfo(await client.info('everything').catch(() => client.info()));
  const i = flatInfo(sections);
  const modules = Object.values(sections.modules ?? {}).map((v) => /name=([^,]+)/.exec(v)?.[1] ?? v);
  const keyspace = parseKeyspace(sections.keyspace);
  return {
    product: i.server_name || 'redis',
    version: i.valkey_version || i.redis_version || 'unknown',
    mode: i.redis_mode || i.server_mode || 'standalone',
    role: i.role || 'master',
    os: i.os || '',
    host: manager.address.replace(/:\d+$/, ''),
    port: num(i.tcp_port),
    uptimeSeconds: num(i.uptime_in_seconds),
    connectedClients: num(i.connected_clients),
    usedMemory: num(i.used_memory),
    peakMemory: num(i.used_memory_peak),
    maxMemory: num(i.maxmemory),
    maxMemoryPolicy: i.maxmemory_policy || '',
    fragmentation: i.mem_fragmentation_ratio ? num(i.mem_fragmentation_ratio) : null,
    totalCommands: num(i.total_commands_processed),
    keyspaceHits: num(i.keyspace_hits),
    keyspaceMisses: num(i.keyspace_misses),
    expiredKeys: num(i.expired_keys),
    evictedKeys: num(i.evicted_keys),
    connectedReplicas: num(i.connected_slaves),
    aofEnabled: i.aof_enabled === '1',
    rdbLastSave: i.rdb_last_save_time ? num(i.rdb_last_save_time) * 1000 : null,
    rdbChangesSinceSave: num(i.rdb_changes_since_last_save),
    databases: Math.max(manager.databases, (keyspace.at(-1)?.index ?? -1) + 1),
    keyspace,
    readonly: manager.readonly,
    modules,
  };
}

export async function statsSample(client: Redis): Promise<StatsSample> {
  const i = flatInfo(parseInfo(await client.info()));
  return {
    t: Date.now(),
    opsPerSec: num(i.instantaneous_ops_per_sec),
    usedMemory: num(i.used_memory),
    clients: num(i.connected_clients),
    keyspaceHits: num(i.keyspace_hits),
    keyspaceMisses: num(i.keyspace_misses),
    inputKbps: num(i.instantaneous_input_kbps),
    outputKbps: num(i.instantaneous_output_kbps),
  };
}

/** The slowest recent commands; empty when SLOWLOG is unavailable (some managed services). */
export async function slowlog(client: Redis, count = 50): Promise<SlowlogEntry[]> {
  const raw = (await client.call('SLOWLOG', ['GET', count]).catch(() => [])) as unknown[][];
  return raw.map((e) => ({
    id: Number(e[0]),
    at: Number(e[1]) * 1000,
    micros: Number(e[2]),
    command: (e[3] as unknown[]).map((a) => (/[\s"]/.test(String(a)) ? JSON.stringify(String(a)) : String(a))).join(' '),
    client: String(e[4] ?? ''),
  }));
}
