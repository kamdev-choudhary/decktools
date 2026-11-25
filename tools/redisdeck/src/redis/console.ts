import { ReplyError, type Redis } from 'ioredis';
import type { CommandResult, Reply } from '../shared/types.js';
import { READONLY_ERROR, UserError } from './errors.js';
import { toRText } from './text.js';

/**
 * Split a command line into arguments the way redis-cli does: whitespace
 * separates, "double quotes" understand \n \r \t \b \a \\ \" and \xHH,
 * 'single quotes' only \'. Returns raw bytes so \xHH can express anything.
 */
export function splitArgs(line: string): Buffer[] {
  const args: Buffer[] = [];
  let i = 0;
  const n = line.length;
  while (true) {
    while (i < n && /\s/.test(line[i]!)) i++;
    if (i >= n) return args;
    const bytes: number[] = [];
    const push = (s: string) => bytes.push(...Buffer.from(s, 'utf8'));
    let inDouble = false;
    let inSingle = false;
    for (; ; i++) {
      const c = line[i];
      if (inDouble) {
        if (c === undefined) throw new UserError('Unbalanced quotes in command');
        if (c === '\\' && line[i + 1] === 'x' && /^[0-9a-f]{2}$/i.test(line.slice(i + 2, i + 4))) {
          bytes.push(parseInt(line.slice(i + 2, i + 4), 16));
          i += 3;
        } else if (c === '\\' && i + 1 < n) {
          const e = line[++i]!;
          push({ n: '\n', r: '\r', t: '\t', b: '\b', a: '\x07' }[e] ?? e);
        } else if (c === '"') {
          // A closing quote must be followed by a space or the end.
          if (i + 1 < n && !/\s/.test(line[i + 1]!)) throw new UserError('Unbalanced quotes in command');
          inDouble = false;
          i++;
          break;
        } else push(c);
      } else if (inSingle) {
        if (c === undefined) throw new UserError('Unbalanced quotes in command');
        if (c === '\\' && line[i + 1] === "'") {
          push("'");
          i++;
        } else if (c === "'") {
          if (i + 1 < n && !/\s/.test(line[i + 1]!)) throw new UserError('Unbalanced quotes in command');
          inSingle = false;
          i++;
          break;
        } else push(c);
      } else {
        if (c === undefined || /\s/.test(c)) break;
        if (c === '"') inDouble = true;
        else if (c === "'") inSingle = true;
        else push(c);
      }
    }
    args.push(Buffer.from(bytes));
  }
}

/** Commands that need a connection to themselves; the console shares one per database. */
const STATEFUL = new Set([
  'subscribe', 'psubscribe', 'ssubscribe', 'unsubscribe', 'punsubscribe', 'sunsubscribe',
  'monitor', 'select', 'swapdb', 'multi', 'exec', 'discard', 'watch', 'unwatch',
  'quit', 'reset', 'hello', 'auth', 'sync', 'psync', 'replconf',
]);

/** Admin commands that only read, still allowed in --readonly mode. */
const READONLY_ADMIN = new Set([
  'config|get', 'slowlog|get', 'slowlog|len', 'client|list', 'client|info', 'client|getname', 'client|id',
  'acl|whoami', 'acl|list', 'acl|users', 'acl|getuser', 'acl|cat', 'acl|log',
  'latency|latest', 'latency|history', 'latency|doctor', 'memory|stats', 'memory|doctor',
  'module|list', 'command|count', 'command|info', 'command|docs', 'command|list', 'lastsave', 'role',
]);

type CommandInfo = [name: string, arity: number, flags: string[], ...rest: unknown[]] | null;

/** Why a command can't run from the console, or null when it can. */
export function refusal(name: string, sub: string | null, flags: string[] | null, readonly: boolean): string | null {
  if (STATEFUL.has(name)) {
    return name === 'select' || name === 'swapdb'
      ? 'Switch databases with the database menu instead of SELECT.'
      : `${name.toUpperCase()} needs a dedicated connection and can't run from the console.`;
  }
  if (name === 'client' && sub === 'reply') return 'CLIENT REPLY would break the console connection.';
  if (!flags) return null; // unknown to COMMAND INFO: let Redis answer
  if (flags.includes('blocking')) return 'Blocking commands can\'t run from the console.';
  if (!readonly) return null;
  const full = sub ? `${name}|${sub}` : name;
  if (flags.includes('write') || flags.includes('may_replicate') || flags.includes('pubsub')) return READONLY_ERROR;
  if (flags.includes('script_runner') && !flags.includes('readonly')) return `${READONLY_ERROR} (use EVAL_RO / FCALL_RO)`;
  if (flags.includes('admin') && !READONLY_ADMIN.has(full) && !READONLY_ADMIN.has(name)) return READONLY_ERROR;
  return null;
}

/** COMMAND INFO flags for a command (or its subcommand, when Redis knows it). */
async function commandFlags(client: Redis, name: string, sub: string | null): Promise<string[] | null> {
  const names = sub ? [name, `${name}|${sub}`] : [name];
  const info = (await client.call('COMMAND', ['INFO', ...names]).catch(() => [])) as CommandInfo[];
  const best = (sub ? info[1] : null) ?? info[0];
  return best ? best[2].map(String) : null;
}

export function toReply(v: unknown): Reply {
  if (v === null || v === undefined) return { kind: 'nil' };
  if (Buffer.isBuffer(v)) return { kind: 'string', value: toRText(v) };
  // The console connection uses stringNumbers, so integers arrive as exact strings.
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') return { kind: 'integer', value: String(v) };
  if (Array.isArray(v)) return { kind: 'array', items: v.map(toReply) };
  if (v instanceof Error) return { kind: 'error', value: v.message };
  return { kind: 'status', value: String(v) };
}

/** Run one console line against a database's console connection. */
export async function runCommand(client: Redis, line: string, readonly: boolean): Promise<CommandResult> {
  const args = splitArgs(line);
  if (!args.length) throw new UserError('Type a command, e.g. GET mykey');
  const name = args[0]!.toString('utf8').toLowerCase();
  const sub = args[1] ? args[1].toString('utf8').toLowerCase() : null;

  const why = refusal(name, sub, await commandFlags(client, name, sub), readonly);
  if (why) throw new UserError(why, why.startsWith(READONLY_ERROR) ? 403 : 400);

  const started = performance.now();
  try {
    const raw = await client.callBuffer(args[0]!.toString('utf8'), args.slice(1));
    return { reply: toReply(raw), ms: performance.now() - started };
  } catch (err) {
    if (err instanceof ReplyError) return { reply: { kind: 'error', value: (err as Error).message }, ms: performance.now() - started };
    throw err;
  }
}
