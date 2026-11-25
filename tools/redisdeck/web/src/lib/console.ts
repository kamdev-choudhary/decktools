import type { CommandDoc, Reply } from '@shared/types';

/** The line the caret is on, split into the text before and after it. */
export function caretLine(value: string, caret: number): { start: number; before: string } {
  const start = value.lastIndexOf('\n', caret - 1) + 1;
  return { start, before: value.slice(start, caret) };
}

const words = (text: string) => text.trimStart().split(/\s+/);

/** The command (or subcommand) a line is calling, e.g. "config get" for "CONFIG GET maxmemory". */
export function docForLine(line: string, docs: Map<string, CommandDoc>): CommandDoc | null {
  const [w0 = '', w1 = ''] = words(line).map((w) => w.toLowerCase());
  if (!w0) return null;
  return docs.get(`${w0} ${w1}`) ?? docs.get(w0) ?? null;
}

export interface Completion {
  /** Offset in the line where the replaced text starts. */
  from: number;
  /** Lower-case text typed so far that the suggestions complete. */
  typed: string;
  items: CommandDoc[];
}

/**
 * Suggestions for the word at the caret: command names while typing the first
 * word, subcommands while typing the second word of a container (CONFIG, CLIENT...).
 */
export function complete(
  before: string,
  docs: CommandDoc[],
  byName: Map<string, CommandDoc>,
  limit = 8,
): Completion | null {
  const lead = before.length - before.trimStart().length;
  const parts = before.slice(lead).split(/\s+/);
  if (parts.length === 1) {
    const typed = parts[0]!.toLowerCase();
    if (!typed) return null;
    const items = docs.filter((d) => !d.name.includes(' ') && d.name.startsWith(typed));
    if (!items.length || (items.length === 1 && items[0]!.name === typed)) return null;
    return { from: lead, typed, items: items.slice(0, limit) };
  }
  if (parts.length === 2 && byName.get(parts[0]!.toLowerCase())?.container) {
    const typed = `${parts[0]!.toLowerCase()} ${parts[1]!.toLowerCase()}`;
    const items = docs.filter((d) => d.name.startsWith(typed) && d.name.includes(' '));
    if (!items.length || (items.length === 1 && items[0]!.name === typed)) return null;
    return { from: lead, typed, items: items.slice(0, limit) };
  }
  return null;
}

/** Commands that destroy data or affect the whole server: confirm before running them. */
const DANGEROUS: Record<string, (db: number) => string> = {
  flushdb: (db) => `Deletes every key in db${db}.`,
  flushall: () => 'Deletes every key in every database on this server.',
  shutdown: () => 'Stops the Redis server.',
  swapdb: () => 'Swaps the contents of two databases for every client.',
  debug: () => 'DEBUG can crash, block or slow down the server.',
  'config set': () => 'Changes server configuration for every client.',
  'config rewrite': () => 'Rewrites the server configuration file on disk.',
  'config resetstat': () => 'Resets the server statistics.',
  'script flush': () => 'Removes every cached Lua script.',
  'function flush': () => 'Deletes every function library.',
  'function delete': () => 'Deletes a function library.',
  'acl deluser': () => 'Deletes ACL users.',
  'acl setuser': () => "Changes an ACL user's permissions.",
  'client kill': () => 'Disconnects clients.',
  replicaof: () => 'Turns this server into a replica (or a primary).',
  slaveof: () => 'Turns this server into a replica (or a primary).',
  failover: () => 'Starts a failover to a replica.',
  'cluster reset': () => 'Resets this cluster node.',
  'cluster failover': () => 'Starts a cluster failover.',
  'module unload': () => 'Unloads a module.',
  keys: () =>
    'KEYS walks the whole keyspace and blocks Redis while it runs. On a large database use SCAN, or the Keys page, instead.',
};

/** Why a line deserves a confirmation, or null. */
export function danger(line: string, db: number): string | null {
  const [w0 = '', w1 = ''] = words(line).map((w) => w.toLowerCase());
  const why = DANGEROUS[`${w0} ${w1}`] ?? DANGEROUS[w0];
  return why ? why(db) : null;
}

/** Split pasted input into commands: one per non-empty line. */
export const commandsIn = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

const quote = (s: string) => `"${s}"`;

/**
 * A reply as redis-cli prints it, for copying. `raw` follows `redis-cli --raw`:
 * no quotes, no type labels, one array element per line.
 */
export function replyToText(reply: Reply, raw = false, indent = ''): string {
  switch (reply.kind) {
    case 'nil':
      return raw ? '' : '(nil)';
    case 'integer':
      return raw ? reply.value : `(integer) ${reply.value}`;
    case 'status':
      return reply.value;
    case 'error':
      return `(error) ${reply.value}`;
    case 'string':
      return raw ? reply.value.text : quote(reply.value.text);
    case 'array': {
      if (!reply.items.length) return raw ? '' : '(empty array)';
      if (raw) return reply.items.map((i) => replyToText(i, true)).join('\n');
      const width = String(reply.items.length).length;
      return reply.items
        .map((item, i) => {
          const label = `${String(i + 1).padStart(width)}) `;
          const pad = indent + ' '.repeat(label.length);
          return `${i === 0 ? '' : indent}${label}${replyToText(item, false, pad)}`;
        })
        .join('\n');
    }
  }
}

/** Number of elements in a top-level array reply, for the entry summary. */
export const replySize = (reply: Reply) => (reply.kind === 'array' ? reply.items.length : null);

/** A string reply that holds a JSON object or array, pretty-printed; null otherwise. */
export function prettyJson(text: string): string | null {
  const t = text.trim();
  if (!(t.startsWith('{') && t.endsWith('}')) && !(t.startsWith('[') && t.endsWith(']'))) return null;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return null;
  }
}
