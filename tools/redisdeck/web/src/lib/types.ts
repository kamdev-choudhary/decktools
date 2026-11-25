import type { KeyType, NewKey } from '@shared/types';

export const TYPE_LABEL: Record<string, string> = {
  string: 'String',
  hash: 'Hash',
  list: 'List',
  set: 'Set',
  zset: 'Sorted set',
  stream: 'Stream',
  'ReJSON-RL': 'JSON',
};

const SHORT: Record<string, string> = { string: 'STR', hash: 'HASH', list: 'LIST', set: 'SET', zset: 'ZSET', stream: 'STRM', 'ReJSON-RL': 'JSON' };

const VAR: Record<string, string> = {
  string: 'var(--type-string)',
  hash: 'var(--type-hash)',
  list: 'var(--type-list)',
  set: 'var(--type-set)',
  zset: 'var(--type-zset)',
  stream: 'var(--type-stream)',
  'ReJSON-RL': 'var(--type-json)',
};

export const typeLabel = (t: KeyType) => TYPE_LABEL[t] ?? t;
export const typeShort = (t: KeyType) => SHORT[t] ?? t.slice(0, 4).toUpperCase();
export const typeColor = (t: KeyType) => VAR[t] ?? 'var(--type-other)';

/** Types offered when creating a key. JSON needs the RedisJSON module. */
export const CREATABLE: { type: NewKey['type']; label: string }[] = [
  { type: 'string', label: 'String' },
  { type: 'hash', label: 'Hash' },
  { type: 'list', label: 'List' },
  { type: 'set', label: 'Set' },
  { type: 'zset', label: 'Sorted set' },
  { type: 'stream', label: 'Stream' },
  { type: 'ReJSON-RL', label: 'JSON' },
];
