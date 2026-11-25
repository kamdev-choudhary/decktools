// Wire types shared by the server and the UI.

export type { SessionInfo } from '@deck/server/types';

export interface LoginRequest {
  username: string;
  password: string;
}

/** Body of every error response. */
export interface ApiErrorBody {
  error: string;
}

/**
 * A Redis string that may not be valid UTF-8. `text` is for display; binary
 * values are escaped the way redis-cli prints them ("\xff") and can't be
 * edited, since the browser can't round-trip their bytes.
 */
export interface RText {
  text: string;
  binary?: true;
}

/** Key types redisdeck can show. Others (modules) are listed but opened read-only. */
export type KeyType = 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | 'ReJSON-RL' | (string & {});

export const EDITABLE_TYPES = ['string', 'hash', 'list', 'set', 'zset', 'stream', 'ReJSON-RL'] as const;

export interface KeySummary {
  /** Raw key bytes, base64. Every key operation takes this, so binary keys work. */
  id: string;
  name: RText;
  type: KeyType;
  /** Milliseconds left, -1 without expiry, -2 if it vanished meanwhile. */
  ttl: number;
}

export interface KeyPage {
  keys: KeySummary[];
  /** SCAN cursor to continue from, "0" when the scan is complete. */
  cursor: string;
}

export interface DbSummary {
  index: number;
  keys: number;
  expires: number;
}

export interface ServerInfo {
  /** "redis", "valkey"... from INFO server_name, else "redis". */
  product: string;
  version: string;
  mode: string;
  role: string;
  os: string;
  host: string;
  port: number;
  uptimeSeconds: number;
  connectedClients: number;
  usedMemory: number;
  peakMemory: number;
  maxMemory: number;
  maxMemoryPolicy: string;
  fragmentation: number | null;
  totalCommands: number;
  keyspaceHits: number;
  keyspaceMisses: number;
  expiredKeys: number;
  evictedKeys: number;
  connectedReplicas: number;
  aofEnabled: boolean;
  rdbLastSave: number | null;
  rdbChangesSinceSave: number;
  /** Number of logical databases (CONFIG GET databases, or a best guess). */
  databases: number;
  keyspace: DbSummary[];
  readonly: boolean;
  modules: string[];
}

/** One live sample, polled every couple of seconds. */
export interface StatsSample {
  t: number;
  opsPerSec: number;
  usedMemory: number;
  clients: number;
  keyspaceHits: number;
  keyspaceMisses: number;
  inputKbps: number;
  outputKbps: number;
}

export interface SlowlogEntry {
  id: number;
  at: number;
  micros: number;
  command: string;
  client: string;
}

/** A type-specific slice of a key's value. Collections are paged. */
export type KeyValue =
  | { type: 'string'; value: RText; truncated: boolean }
  | { type: 'hash'; entries: { field: RText; value: RText }[]; cursor: string }
  | { type: 'list'; items: { index: number; value: RText }[]; offset: number }
  | { type: 'set'; members: RText[]; cursor: string }
  | { type: 'zset'; members: { member: RText; score: string }[]; offset: number }
  | { type: 'stream'; entries: { id: string; fields: { field: RText; value: RText }[] }[]; next: string | null }
  | { type: 'ReJSON-RL'; json: string }
  | { type: 'unsupported'; message: string };

export interface KeyDetail {
  id: string;
  name: RText;
  type: KeyType;
  ttl: number;
  /** Elements in a collection, bytes in a string. */
  length: number;
  encoding: string | null;
  /** Bytes, from MEMORY USAGE (null when the server doesn't allow it). */
  memory: number | null;
  value: KeyValue;
}

/** Changes to keys. Every one of them is refused in --readonly mode. */
export type KeyAction =
  | { op: 'delete'; ids: string[] }
  | { op: 'rename'; id: string; newName: string }
  | { op: 'expire'; id: string; seconds: number | null }
  | { op: 'string.set'; id: string; value: string }
  | { op: 'hash.set'; id: string; field: string; value: string; previousField?: string }
  | { op: 'hash.delete'; id: string; fields: string[] }
  | { op: 'list.set'; id: string; index: number; value: string }
  | { op: 'list.push'; id: string; value: string; end: 'head' | 'tail' }
  | { op: 'list.delete'; id: string; index: number }
  | { op: 'set.add'; id: string; member: string; previous?: string }
  | { op: 'set.delete'; id: string; members: string[] }
  | { op: 'zset.add'; id: string; member: string; score: number; previous?: string }
  | { op: 'zset.delete'; id: string; members: string[] }
  | { op: 'stream.add'; id: string; fields: Record<string, string> }
  | { op: 'stream.delete'; id: string; entryIds: string[] }
  | { op: 'json.set'; id: string; json: string };

export type NewKey =
  | { type: 'string'; name: string; value: string; ttl?: number }
  | { type: 'hash'; name: string; field: string; value: string; ttl?: number }
  | { type: 'list'; name: string; value: string; ttl?: number }
  | { type: 'set'; name: string; member: string; ttl?: number }
  | { type: 'zset'; name: string; member: string; score: number; ttl?: number }
  | { type: 'stream'; name: string; field: string; value: string; ttl?: number }
  | { type: 'ReJSON-RL'; name: string; json: string; ttl?: number };

/** A reply from the console, shaped like redis-cli's output. */
export type Reply =
  | { kind: 'status'; value: string }
  | { kind: 'string'; value: RText }
  | { kind: 'integer'; value: string }
  | { kind: 'nil' }
  | { kind: 'error'; value: string }
  | { kind: 'array'; items: Reply[] };

export interface CommandResult {
  reply: Reply;
  ms: number;
}
