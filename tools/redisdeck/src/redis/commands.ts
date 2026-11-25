import type { Redis } from 'ioredis';
import type { CommandDoc } from '../shared/types.js';
import { refusal } from './console.js';

/** A flat [key, value, key, value...] reply as an object. */
function pairs(flat: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!Array.isArray(flat)) return out;
  for (let i = 0; i + 1 < flat.length; i += 2) out[String(flat[i])] = flat[i + 1];
  return out;
}

/**
 * One COMMAND DOCS argument as redis-cli and redis.io show it:
 * `[NX | XX]`, `key [key ...]`, `EX seconds`, `<a | b>`.
 */
export function renderArg(raw: unknown): string {
  const a = pairs(raw);
  const type = String(a.type ?? '');
  const flags = Array.isArray(a.flags) ? a.flags.map(String) : [];
  const optional = flags.includes('optional');
  const multiple = flags.includes('multiple');
  const children = Array.isArray(a.arguments) ? a.arguments.map(renderArg) : [];
  const token = a.token === undefined ? null : String(a.token);

  let body: string;
  if (type === 'pure-token') body = token ?? String(a.name);
  else if (type === 'oneof') body = children.join(' | ');
  else if (type === 'block') body = children.join(' ');
  else body = String(a.display_text ?? a.name);

  if (token && type !== 'pure-token') body = `${token} ${body}`;
  if (type === 'oneof' && !optional) body = `<${body}>`;
  if (multiple) body = `${body} [${body} ...]`;
  return optional ? `[${body}]` : body;
}

/** Flags per command and subcommand ("config|get"), from COMMAND. */
async function commandFlags(client: Redis): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const all = (await client.call('COMMAND').catch(() => [])) as unknown[][];
  for (const c of all) {
    out.set(String(c[0]).toLowerCase(), (c[2] as unknown[]).map(String));
    for (const sub of (c[9] as unknown[][] | undefined) ?? [])
      out.set(String(sub[0]).toLowerCase(), (sub[2] as unknown[]).map(String));
  }
  return out;
}

function docFor(name: string, rawDoc: unknown, flags: string[] | undefined, readonly: boolean): CommandDoc {
  const d = pairs(rawDoc);
  const [cmd, sub] = name.split('|') as [string, string | undefined];
  const args = Array.isArray(d.arguments) ? d.arguments.map(renderArg) : [];
  return {
    name: sub ? `${cmd} ${sub}` : cmd,
    summary: String(d.summary ?? ''),
    syntax: args.join(' '),
    group: String(d.group ?? ''),
    since: String(d.since ?? ''),
    flags: flags ?? [],
    refused: refusal(cmd, sub ?? null, flags ?? null, readonly),
    container: Array.isArray(d.subcommands) && d.subcommands.length > 0,
  };
}

/**
 * Every command the server knows, with syntax and summary for autocomplete
 * and hints. Uses COMMAND DOCS (Redis 7+); older servers get names only.
 */
export async function commandCatalog(client: Redis, readonly: boolean): Promise<CommandDoc[]> {
  const flags = await commandFlags(client);
  const docs = (await client.call('COMMAND', ['DOCS']).catch(() => null)) as unknown[] | null;
  const out: CommandDoc[] = [];

  if (docs && docs.length) {
    for (let i = 0; i + 1 < docs.length; i += 2) {
      const name = String(docs[i]).toLowerCase();
      out.push(docFor(name, docs[i + 1], flags.get(name), readonly));
      const subs = pairs(docs[i + 1]).subcommands;
      if (Array.isArray(subs)) {
        for (let j = 0; j + 1 < subs.length; j += 2) {
          const subName = String(subs[j]).toLowerCase();
          out.push(docFor(subName, subs[j + 1], flags.get(subName), readonly));
        }
      }
    }
  } else {
    for (const [name, f] of flags) out.push(docFor(name, [], f, readonly));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
